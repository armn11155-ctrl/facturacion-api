import cron from 'node-cron'
import { getDb } from '../lib/firebase.js'
import { FieldValue } from 'firebase-admin/firestore'
import { enviarResumenDiario, enviarASunat } from '../services/sunat.js'
import { enviarCorreoFactura, enviarAlertaRechazo, enviarRecordatorioCobranza, enviarRespuestaLead } from '../services/email.js'
import { enviarDigestDiario } from '../services/digest.js'

// ── Logger simple ──────────────────────────────────────────────────
const log  = (job, msg) => console.log(`[CRON:${job}] ${new Date().toISOString()} — ${msg}`)
const warn = (job, msg) => console.warn(`[CRON:${job}] ⚠️  ${msg}`)

/** Fecha de hoy como string "YYYY-MM-DD" */
const hoyStr = () => new Date().toISOString().split('T')[0]

/** Suma N días a hoy y devuelve "YYYY-MM-DD" */
const enDias = (n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

/** Resta N días a hoy y devuelve "YYYY-MM-DD" */
const haceDias = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

// ══════════════════════════════════════════════════════════════════
// JOB 1 — Marcar facturas vencidas
// ══════════════════════════════════════════════════════════════════
export async function marcarFacturasVencidas() {
  const hoy = hoyStr()
  log('VENCIDAS', `Iniciando. Fecha: ${hoy}`)

  try {
    const db   = getDb()
    const snap = await db.collection('facturas')
      .where('deleted',           '==', false)
      .where('estado',            'in', ['Emitida', 'Aceptada', 'Pendiente'])
      .where('fecha_vencimiento', '<',  hoy)
      .get()

    if (snap.empty) {
      log('VENCIDAS', 'Sin facturas a vencer. Nada que hacer.')
      return
    }

    const batch = db.batch()
    snap.docs.forEach(doc => {
      batch.update(doc.ref, { estado: 'Vencida', updatedAt: FieldValue.serverTimestamp() })
    })
    await batch.commit()

    log('VENCIDAS', `✅ ${snap.size} factura(s) marcada(s) como Vencida.`)
  } catch (err) {
    warn('VENCIDAS', err.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 2 — Liberar paneles con todos sus contratos vencidos
// ══════════════════════════════════════════════════════════════════
export async function liberarPanelesVencidos() {
  const hoy = hoyStr()
  log('PANELES', `Iniciando. Fecha: ${hoy}`)

  try {
    const db = getDb()

    const vencidosSnap = await db.collection('contratos')
      .where('deleted', '==', false)
      .where('fin',     '<',  hoy)
      .get()

    if (vencidosSnap.empty) {
      log('PANELES', 'Sin contratos vencidos. Nada que hacer.')
      return
    }

    const conVencido = new Set(vencidosSnap.docs.map(d => d.data().panel_id).filter(Boolean))

    const activosSnap = await db.collection('contratos')
      .where('deleted', '==', false)
      .where('fin',     '>=', hoy)
      .get()

    const conActivo = new Set(activosSnap.docs.map(d => d.data().panel_id).filter(Boolean))

    const panelesALiberar = [...conVencido].filter(pid => !conActivo.has(pid))

    if (panelesALiberar.length === 0) {
      log('PANELES', 'Todos los paneles vencidos tienen contratos activos aún.')
      return
    }

    const batch = db.batch()
    let actualizados = 0

    for (const panelId of panelesALiberar) {
      const panelDoc = await db.collection('paneles').doc(panelId).get()
      if (!panelDoc.exists) continue
      if (panelDoc.data().estado !== 'Ocupado') continue

      batch.update(panelDoc.ref, { estado: 'Disponible', updatedAt: FieldValue.serverTimestamp() })
      actualizados++
      log('PANELES', `Panel ${panelId} → Disponible`)
    }

    if (actualizados > 0) {
      await batch.commit()
      log('PANELES', `✅ ${actualizados} panel(es) liberado(s).`)
    }
  } catch (err) {
    warn('PANELES', err.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 3 — Generar borradores de factura automáticamente
// ══════════════════════════════════════════════════════════════════
const DIAS_ANTICIPACION = 7

export async function generarBorradoresFactura() {
  const hoy    = hoyStr()
  const limite = enDias(DIAS_ANTICIPACION)
  log('BORRADORES', `Iniciando. Ventana: ${hoy} → ${limite}`)

  try {
    const db = getDb()

    const snap = await db.collection('contratos')
      .where('deleted', '==', false)
      .where('fin',     '>=', hoy)
      .where('fin',     '<=', limite)
      .get()

    if (snap.empty) {
      log('BORRADORES', 'Sin contratos próximos a vencer. Nada que hacer.')
      return
    }

    let creados  = 0
    let omitidos = 0

    for (const contratoDoc of snap.docs) {
      const contrato = { id: contratoDoc.id, ...contratoDoc.data() }

      if (contrato.factura_id) {
        try {
          const facExist = await db.collection('facturas').doc(contrato.factura_id).get()
          if (facExist.exists) {
            const st = facExist.data().estado
            if (!['Anulada', 'Rechazada'].includes(st)) { omitidos++; continue }
          }
        } catch { omitidos++; continue }
      }

      let panel   = { nombre: 'Panel', ciudad: '', tipo: '', direccion: '' }
      let cliente = { empresa: 'Cliente', ruc: '', email: null, direccion: null }

      if (contrato.panel_id) {
        try {
          const pd = await db.collection('paneles').doc(contrato.panel_id).get()
          if (pd.exists) panel = { id: pd.id, ...pd.data() }
        } catch {}
      }

      if (contrato.cliente_id) {
        try {
          const cd = await db.collection('clientes').doc(contrato.cliente_id).get()
          if (cd.exists) cliente = { id: cd.id, ...cd.data() }
        } catch {}
      }

      const monto    = Number(contrato.monto || 0)
      const subtotal = Number((monto / 1.18).toFixed(2))
      const igv      = Number((monto - subtotal).toFixed(2))

      const serie    = 'F001'
      const tipDoc   = '01'
      const lastSnap = await db.collection('facturas')
        .where('serie', '==', serie).where('tipo_doc', '==', tipDoc).where('deleted', '==', false)
        .orderBy('numero', 'desc').limit(1).get()

      const numero     = lastSnap.empty ? 1 : (lastSnap.docs[0].data().numero || 0) + 1
      const numero_fmt = `${serie}-${String(numero).padStart(8, '0')}`

      const nuevaFactura = {
        tipo_doc: tipDoc, serie, numero, numero_fmt,
        fecha_emision: hoy, fecha_vencimiento: contrato.fin,
        emisor_ruc: process.env.EMISOR_RUC, emisor_razon: process.env.EMISOR_RAZON_SOCIAL,
        cliente_tipo_doc: 'RUC', cliente_doc: cliente.ruc || '',
        cliente_nombre: cliente.empresa || 'Cliente',
        cliente_email: cliente.email || null, cliente_direccion: cliente.direccion || null,
        cliente_id: contrato.cliente_id || null, panel_id: contrato.panel_id || null,
        panel_nombre: panel.nombre || null, cara_panel: contrato.cara || null,
        periodo_inicio: contrato.inicio || null, periodo_fin: contrato.fin || null,
        concepto: `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} (${contrato.inicio} → ${contrato.fin})`,
        moneda: 'PEN', es_exonerado: false,
        subtotal, igv, total: monto, op_gravada: subtotal, op_exonerada: 0, op_inafecta: 0,
        items: [{
          orden: 1,
          descripcion: `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} · ${panel.ciudad || ''} (${contrato.inicio} → ${contrato.fin})`,
          unidad_medida: 'ZZ', cantidad: 1, precio_unitario: subtotal,
          subtotal, igv_item: igv, total: monto,
        }],
        estado: 'Borrador', deleted: false, origen: 'cron_auto', creado_por: 'sistema',
        createdAt: FieldValue.serverTimestamp(),
      }

      try {
        const ref = await db.collection('facturas').add(nuevaFactura)
        await contratoDoc.ref.update({
          factura_id: ref.id, factura_numero: numero_fmt, factura_estado: 'Borrador',
          updatedAt: FieldValue.serverTimestamp(),
        })
        creados++
        log('BORRADORES', `✅ ${numero_fmt} — ${cliente.empresa} · Panel: ${panel.nombre}`)
      } catch (err) {
        warn('BORRADORES', `Error contrato ${contrato.id}: ${err.message}`)
      }
    }

    log('BORRADORES', `Fin. Creados: ${creados} | Omitidos: ${omitidos}`)
  } catch (err) {
    warn('BORRADORES', `Error fatal: ${err.message}`)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 4 — Resumen Diario de Boletas (RC)
// ══════════════════════════════════════════════════════════════════
// Corre diariamente a las 23:00 hora Lima.
// Envía a SUNAT el Resumen Diario (SummaryDocuments RC) con todas las
// boletas emitidas en el día anterior que aún no fueron declaradas.
// SUNAT exige el RC antes de las 24h del día siguiente a la emisión.
// ══════════════════════════════════════════════════════════════════
export async function enviarResumenDiarioCron() {
  const ayer = haceDias(1)
  log('RC', `Iniciando. Procesando boletas de: ${ayer}`)

  try {
    const result = await enviarResumenDiario(ayer)
    if (result.count === 0) {
      log('RC', `Sin boletas para declarar en ${ayer}`)
    } else {
      log('RC', `✅ ${result.mensaje} — ${result.count} boleta(s) — RC: ${result.rcId}`)
    }
  } catch (err) {
    warn('RC', err.message)
    // Guardar el error en Firestore para diagnóstico
    try {
      const db = getDb()
      await db.collection('cron_errores').add({
        job: 'RC', fecha_ref: ayer, error: err.message,
        createdAt: FieldValue.serverTimestamp(),
      })
    } catch {}
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 5 — Reintentar emisiones que fallaron por SUNAT caído
// ══════════════════════════════════════════════════════════════════
// Procesa facturas marcadas con sunat_estado = 'Pendiente_Reintento'
// (errores de red/timeout, NO rechazos de negocio). Reintenta enviar
// a SUNAT hasta MAX_REINTENTOS veces.
// ══════════════════════════════════════════════════════════════════
const MAX_REINTENTOS = 5

export async function reintentarEmisionesPendientes() {
  log('REINTENTO', 'Buscando emisiones pendientes por SUNAT caído...')
  try {
    const db = getDb()
    const snap = await db.collection('facturas')
      .where('deleted', '==', false)
      .where('sunat_estado', '==', 'Pendiente_Reintento')
      .get()

    if (snap.empty) { log('REINTENTO', 'Sin emisiones pendientes.'); return }

    let reenviadas = 0, agotadas = 0
    for (const doc of snap.docs) {
      const factura = { id: doc.id, ...doc.data() }
      if ((factura.reintentos || 0) >= MAX_REINTENTOS) {
        // Agotó reintentos: dejar en error definitivo y avisar al admin
        await doc.ref.update({ sunat_estado: 'Error_Definitivo', updatedAt: FieldValue.serverTimestamp() })
        await enviarAlertaRechazo(factura, `No se pudo emitir tras ${MAX_REINTENTOS} intentos: ${factura.sunat_mensaje || ''}`, 'Reintento agotado').catch(() => {})
        agotadas++
        continue
      }

      try {
        await doc.ref.update({ estado: 'Emitiendo', updatedAt: FieldValue.serverTimestamp() })
        const result = await enviarASunat(factura.id, factura, factura.items || [])
        await doc.ref.update({ sunat_estado: 'Aceptado', updatedAt: FieldValue.serverTimestamp() })
        await enviarCorreoFactura(factura).catch(() => {})
        reenviadas++
        log('REINTENTO', `✅ ${factura.numero_fmt} emitida — ${result.mensaje}`)
      } catch (err) {
        const msg = err?.message || 'Error desconocido'
        if (/rechaz/i.test(msg)) {
          // Era un rechazo de negocio, no SUNAT caído: sacar de la cola
          await doc.ref.update({
            estado: 'Rechazada', sunat_estado: 'Rechazado', sunat_mensaje: msg,
            rechazo_notificado: false, updatedAt: FieldValue.serverTimestamp(),
          })
        } else {
          await doc.ref.update({
            estado: 'Borrador', sunat_estado: 'Pendiente_Reintento', sunat_mensaje: msg,
            reintentos: FieldValue.increment(1), ultimo_intento_at: new Date().toISOString(),
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
        warn('REINTENTO', `${factura.numero_fmt}: ${msg}`)
      }
    }
    log('REINTENTO', `Fin. Reenviadas: ${reenviadas} | Agotadas: ${agotadas}`)
  } catch (err) {
    warn('REINTENTO', `Error fatal: ${err.message}`)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 6 — Alertar al admin de comprobantes rechazados por SUNAT
// ══════════════════════════════════════════════════════════════════
export async function alertarRechazos() {
  log('RECHAZOS', 'Buscando comprobantes rechazados sin notificar...')
  try {
    const db = getDb()
    const snap = await db.collection('facturas')
      .where('deleted', '==', false)
      .where('estado', '==', 'Rechazada')
      .get()

    const pendientes = snap.docs.filter(d => d.data().rechazo_notificado !== true)
    if (pendientes.length === 0) { log('RECHAZOS', 'Nada que notificar.'); return }

    let notificadas = 0
    for (const doc of pendientes) {
      const factura = { id: doc.id, ...doc.data() }
      const r = await enviarAlertaRechazo(factura, factura.sunat_mensaje || '', 'Emisión')
      if (r.ok) {
        await doc.ref.update({ rechazo_notificado: true, rechazo_notificado_at: new Date().toISOString() })
        notificadas++
      }
    }
    log('RECHAZOS', `✅ ${notificadas} alerta(s) enviada(s).`)
  } catch (err) {
    warn('RECHAZOS', err.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 7 — Recordatorios de cobranza al cliente
// ══════════════════════════════════════════════════════════════════
// Envía: 3 días antes del vencimiento, el día del vencimiento,
// y 3 y 7 días después si sigue sin pagarse.
// ══════════════════════════════════════════════════════════════════
function diasEntre(fechaStr, hoy = new Date()) {
  if (!fechaStr) return null
  const v = new Date(fechaStr + 'T00:00:00')
  const h = new Date(hoy.toISOString().split('T')[0] + 'T00:00:00')
  return Math.round((v - h) / 86400000) // >0 faltan días, 0 hoy, <0 vencida
}

export async function enviarRecordatoriosCobranza() {
  log('COBRANZA', 'Revisando facturas por cobrar...')
  try {
    const db = getDb()
    const snap = await db.collection('facturas')
      .where('deleted', '==', false)
      .where('estado', 'in', ['Emitida', 'Aceptada', 'Vencida'])
      .get()

    if (snap.empty) { log('COBRANZA', 'Sin facturas por cobrar.'); return }

    let enviados = 0
    for (const doc of snap.docs) {
      const f = { id: doc.id, ...doc.data() }
      if (!f.cliente_email || !f.fecha_vencimiento) continue
      if (['Pagada', 'Cobrada', 'Anulada'].includes(f.estado)) continue

      const d = diasEntre(f.fecha_vencimiento)
      let fase = null, clave = null, dias = 0
      if (d === 3)        { fase = 'previo';      clave = 'previo';     dias = 3 }
      else if (d === 0)   { fase = 'vencimiento'; clave = 'vencimiento' }
      else if (d === -3)  { fase = 'vencido';     clave = 'vencido_3';  dias = 3 }
      else if (d === -7)  { fase = 'vencido';     clave = 'vencido_7';  dias = 7 }
      if (!fase) continue

      const enviado = f.cobranza_enviada || {}
      if (enviado[clave]) continue // ya se envió esta fase

      const r = await enviarRecordatorioCobranza(f, fase, dias)
      if (r.ok) {
        await doc.ref.update({
          [`cobranza_enviada.${clave}`]: true,
          cobranza_ultimo_envio: new Date().toISOString(),
          updatedAt: FieldValue.serverTimestamp(),
        })
        enviados++
      }
    }
    log('COBRANZA', `✅ ${enviados} recordatorio(s) enviado(s).`)
  } catch (err) {
    warn('COBRANZA', err.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 8 — Borradores mensuales: 1 borrador por mes PAGADO no facturado
// ══════════════════════════════════════════════════════════════════
// Flujo real del negocio: se factura mes a mes cuando el cliente paga.
// Cuando marcas pagosMeses["YYYY-MM"] = true en un contrato, este job
// crea el BORRADOR de factura de ese mes (monto = precio mensual),
// listo para que lo emitas con un clic. NUNCA emite solo.
// Dedup: no crea si el mes ya está en mesesFacturados ni si ya existe
// un borrador para ese contrato+mes.
// ══════════════════════════════════════════════════════════════════

/** Enumera los meses "YYYY-MM" entre dos fechas "YYYY-MM-DD" (inclusive). */
function enumerarMeses(inicioStr, finStr) {
  if (!inicioStr || !finStr) return []
  const ini = new Date(inicioStr + 'T00:00:00')
  const fin = new Date(finStr + 'T00:00:00')
  const out = []
  const d = new Date(ini.getFullYear(), ini.getMonth(), 1)
  const tope = new Date(fin.getFullYear(), fin.getMonth(), 1)
  while (d <= tope) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() + 1)
  }
  return out
}

export async function generarBorradoresMensuales() {
  log('BORR-MES', 'Buscando meses pagados sin facturar...')
  try {
    const db = getDb()

    // Numeración local incremental (evita carreras al crear varios borradores)
    const serie = 'F001', tipDoc = '01'
    const lastSnap = await db.collection('facturas')
      .where('serie', '==', serie).where('tipo_doc', '==', tipDoc).where('deleted', '==', false)
      .orderBy('numero', 'desc').limit(1).get()
    let proximoNumero = lastSnap.empty ? 1 : (lastSnap.docs[0].data().numero || 0) + 1

    const contratosSnap = await db.collection('contratos').where('deleted', '==', false).get()
    if (contratosSnap.empty) { log('BORR-MES', 'Sin contratos.'); return }

    let creados = 0, omitidos = 0
    for (const cDoc of contratosSnap.docs) {
      const contrato = { id: cDoc.id, ...cDoc.data() }
      const pagos = contrato.pagosMeses || {}
      const facturados = contrato.mesesFacturados || {}

      // Meses dentro del periodo del contrato que están pagados
      const mesesContrato = enumerarMeses(contrato.inicio, contrato.fin)
      const mesesPagados = mesesContrato.filter(m => pagos[m] === true)
      if (mesesPagados.length === 0) continue

      // Datos de panel y cliente (una vez por contrato)
      let panel = { nombre: 'Panel', ciudad: '', tipo: '' }
      let cliente = { empresa: 'Cliente', ruc: '', email: null, direccion: null }
      if (contrato.panel_id) {
        try { const pd = await db.collection('paneles').doc(contrato.panel_id).get(); if (pd.exists) panel = { id: pd.id, ...pd.data() } } catch { /* opcional */ }
      }
      if (contrato.cliente_id) {
        try { const cd = await db.collection('clientes').doc(contrato.cliente_id).get(); if (cd.exists) cliente = { id: cd.id, ...cd.data() } } catch { /* opcional */ }
      }

      for (const mes of mesesPagados) {
        // Dedup 1: ya facturado (Emitida/Cobrada)
        if (facturados[mes]) { omitidos++; continue }
        // Dedup 2: ya existe un borrador/factura para este contrato+mes
        const existe = await db.collection('facturas')
          .where('contrato_id', '==', contrato.id)
          .where('periodo_mes', '==', mes)
          .where('deleted', '==', false)
          .limit(1).get()
        if (!existe.empty) { omitidos++; continue }

        const montoMensual = Number(contrato.monto || 0)
        const subtotal = Number((montoMensual / 1.18).toFixed(2))
        const igv = Number((montoMensual - subtotal).toFixed(2))
        const numero = proximoNumero++
        const numero_fmt = `${serie}-${String(numero).padStart(8, '0')}`
        const hoy = hoyStr()
        const etiquetaMes = mes // "YYYY-MM"

        const nuevaFactura = {
          tipo_doc: tipDoc, serie, numero, numero_fmt,
          fecha_emision: hoy, fecha_vencimiento: contrato.fin,
          emisor_ruc: process.env.EMISOR_RUC, emisor_razon: process.env.EMISOR_RAZON_SOCIAL,
          cliente_tipo_doc: 'RUC', cliente_doc: cliente.ruc || '',
          cliente_nombre: cliente.empresa || 'Cliente',
          cliente_email: cliente.email || null, cliente_direccion: cliente.direccion || null,
          cliente_id: contrato.cliente_id || null,
          panel_id: contrato.panel_id || null, panel_nombre: panel.nombre || null,
          cara_panel: contrato.cara || null,
          contrato_id: contrato.id, periodo_mes: etiquetaMes,
          periodo_inicio: contrato.inicio || null, periodo_fin: contrato.fin || null,
          concepto: `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} · ${panel.ciudad || ''} — mes ${etiquetaMes}`,
          moneda: 'PEN', es_exonerado: false,
          subtotal, igv, total: montoMensual, op_gravada: subtotal, op_exonerada: 0, op_inafecta: 0,
          items: [{
            orden: 1,
            descripcion: `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} (${etiquetaMes})`,
            unidad_medida: 'ZZ', cantidad: 1, precio_unitario: subtotal,
            subtotal, igv_item: igv, total: montoMensual,
          }],
          estado: 'Borrador', deleted: false, origen: 'cron_mensual', creado_por: 'sistema',
          createdAt: FieldValue.serverTimestamp(),
        }

        try {
          await db.collection('facturas').add(nuevaFactura)
          creados++
          log('BORR-MES', `✅ ${numero_fmt} — ${cliente.empresa} · ${panel.nombre} · ${etiquetaMes}`)
        } catch (err) {
          proximoNumero-- // liberar el número si falló
          warn('BORR-MES', `Error contrato ${contrato.id} mes ${mes}: ${err.message}`)
        }
      }
    }
    log('BORR-MES', `Fin. Creados: ${creados} | Omitidos: ${omitidos}`)
  } catch (err) {
    warn('BORR-MES', `Error fatal: ${err.message}`)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 10 — Respuesta automática a leads nuevos del formulario web
// ══════════════════════════════════════════════════════════════════
// Documento de bienvenida (sin precios) apenas llega una solicitud.
// NO crea cliente ni contrato — solo responde rápido mientras el
// asesor (Alan) hace seguimiento real. Marca respondido=true para
// no enviarlo dos veces.
// ══════════════════════════════════════════════════════════════════
export async function responderLeadsNuevos() {
  log('LEADS-WEB', 'Buscando solicitudes nuevas sin responder...')
  try {
    const db = getDb()
    const snap = await db.collection('solicitudesWeb').get()
    const pendientes = snap.docs.filter(d => d.data().respondido !== true && d.data().email)

    if (pendientes.length === 0) { log('LEADS-WEB', 'Sin solicitudes nuevas.'); return }

    let enviados = 0
    for (const doc of pendientes) {
      const solicitud = { id: doc.id, ...doc.data() }
      const r = await enviarRespuestaLead(solicitud)
      if (r.ok) {
        await doc.ref.update({ respondido: true, respondido_at: new Date().toISOString() })
        enviados++
        log('LEADS-WEB', `✅ Respondido: ${solicitud.contacto || solicitud.email}`)
      } else {
        warn('LEADS-WEB', `${solicitud.email}: ${r.error}`)
      }
    }
    log('LEADS-WEB', `Fin. Respondidos: ${enviados}/${pendientes.length}`)
  } catch (err) {
    warn('LEADS-WEB', `Error fatal: ${err.message}`)
  }
}

// ══════════════════════════════════════════════════════════════════
// REGISTRO DE TODOS LOS JOBS
// ══════════════════════════════════════════════════════════════════
export function iniciarCrons() {
  // Job 1 — Facturas vencidas: diario 06:00 AM Lima
  cron.schedule('0 6 * * *', marcarFacturasVencidas, { timezone: 'America/Lima' })

  // Job 2 — Paneles libres: diario 06:10 AM Lima
  cron.schedule('10 6 * * *', liberarPanelesVencidos, { timezone: 'America/Lima' })

  // Job 3 (reemplazado) — antes: 1 borrador al vencer el contrato (no calzaba
  // con facturación mensual). Ahora se usa generarBorradoresMensuales (Job 8).
  // generarBorradoresFactura queda disponible pero ya no se agenda.

  // Job 8 — Borradores mensuales por mes pagado: diario 07:00 AM Lima
  cron.schedule('0 7 * * *', generarBorradoresMensuales, { timezone: 'America/Lima' })

  // Job 4 — Resumen Diario de Boletas (RC): diario 23:00 Lima
  // Procesa boletas de ayer que aún no tienen RC enviado.
  cron.schedule('0 23 * * *', enviarResumenDiarioCron, { timezone: 'America/Lima' })

  // Job 5 — Reintentar emisiones por SUNAT caído: cada 30 min
  cron.schedule('*/30 * * * *', reintentarEmisionesPendientes, { timezone: 'America/Lima' })

  // Job 6 — Alertar rechazos sin notificar: cada hora
  cron.schedule('15 * * * *', alertarRechazos, { timezone: 'America/Lima' })

  // Job 7 — Recordatorios de cobranza al cliente: diario 09:00 Lima
  cron.schedule('0 9 * * *', enviarRecordatoriosCobranza, { timezone: 'America/Lima' })

  // Job 9 — Resumen diario al gerente: diario 07:30 Lima
  cron.schedule('30 7 * * *', enviarDigestDiario, { timezone: 'America/Lima' })

  // Job 10 — Responder leads nuevos del formulario web: cada 10 min
  cron.schedule('*/10 * * * *', responderLeadsNuevos, { timezone: 'America/Lima' })

  console.log('⏰  Crons registrados (hora Lima):')
  console.log('   · 06:00 — Marcar facturas vencidas')
  console.log('   · 06:10 — Liberar paneles sin contrato activo')
  console.log('   · 07:00 — Borradores de factura por mes pagado (listos para emitir)')
  console.log('   · 07:30 — Resumen diario al gerente (pendientes del día)')
  console.log('   · 09:00 — Recordatorios de cobranza al cliente')
  console.log('   · 23:00 — Resumen Diario de Boletas (RC) → SUNAT')
  console.log('   · cada 30 min — Reintentar emisiones por SUNAT caído')
  console.log('   · cada hora — Alertar comprobantes rechazados')
  console.log('   · cada 10 min — Responder leads nuevos del formulario web')
}
