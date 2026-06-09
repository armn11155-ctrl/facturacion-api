import cron from 'node-cron'
import { getDb } from '../lib/firebase.js'
import { FieldValue } from 'firebase-admin/firestore'

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

// ══════════════════════════════════════════════════════════════════
// JOB 1 — Marcar facturas vencidas
// ══════════════════════════════════════════════════════════════════
// Corre diariamente a las 06:00 AM (hora Lima).
// Facturas con fecha_vencimiento < hoy y estado Emitida | Aceptada | Pendiente
// pasan a estado "Vencida" mediante un batch atómico.
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
      batch.update(doc.ref, {
        estado:    'Vencida',
        updatedAt: FieldValue.serverTimestamp(),
      })
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
// Corre diariamente a las 06:10 AM (hora Lima).
// Un panel pasa a "Disponible" solo si:
//   - Su estado actual es "Ocupado"
//   - NO tiene ningún contrato activo (fin >= hoy)
// ══════════════════════════════════════════════════════════════════
export async function liberarPanelesVencidos() {
  const hoy = hoyStr()
  log('PANELES', `Iniciando. Fecha: ${hoy}`)

  try {
    const db = getDb()

    // Paneles que aparecen en contratos ya vencidos
    const vencidosSnap = await db.collection('contratos')
      .where('deleted', '==', false)
      .where('fin',     '<',  hoy)
      .get()

    if (vencidosSnap.empty) {
      log('PANELES', 'Sin contratos vencidos. Nada que hacer.')
      return
    }

    const conVencido = new Set(
      vencidosSnap.docs.map(d => d.data().panel_id).filter(Boolean)
    )

    // Paneles que SÍ tienen un contrato activo todavía
    const activosSnap = await db.collection('contratos')
      .where('deleted', '==', false)
      .where('fin',     '>=', hoy)
      .get()

    const conActivo = new Set(
      activosSnap.docs.map(d => d.data().panel_id).filter(Boolean)
    )

    // Solo los paneles que ya no tienen contrato activo
    const panelesALiberar = [...conVencido].filter(pid => !conActivo.has(pid))

    if (panelesALiberar.length === 0) {
      log('PANELES', 'Todos los paneles vencidos tienen contratos activos aún. Nada que hacer.')
      return
    }

    const batch = db.batch()
    let actualizados = 0

    for (const panelId of panelesALiberar) {
      const panelDoc = await db.collection('paneles').doc(panelId).get()
      if (!panelDoc.exists) continue
      if (panelDoc.data().estado !== 'Ocupado') continue  // ya libre o en mantenimiento

      batch.update(panelDoc.ref, {
        estado:    'Disponible',
        updatedAt: FieldValue.serverTimestamp(),
      })
      actualizados++
      log('PANELES', `Panel ${panelId} (${panelDoc.data().nombre}) → Disponible`)
    }

    if (actualizados > 0) {
      await batch.commit()
      log('PANELES', `✅ ${actualizados} panel(es) liberado(s).`)
    } else {
      log('PANELES', 'Sin paneles "Ocupado" para liberar.')
    }
  } catch (err) {
    warn('PANELES', err.message)
  }
}

// ══════════════════════════════════════════════════════════════════
// JOB 3 — Generar borradores de factura automáticamente
// ══════════════════════════════════════════════════════════════════
// Corre diariamente a las 07:00 AM (hora Lima).
// Detecta contratos cuyo período termina en los próximos
// DIAS_ANTICIPACION días y sin factura activa vinculada.
// Crea un Borrador listo para que el operador solo revise y emita.
// ══════════════════════════════════════════════════════════════════
const DIAS_ANTICIPACION = 7

export async function generarBorradoresFactura() {
  const hoy    = hoyStr()
  const limite = enDias(DIAS_ANTICIPACION)
  log('BORRADORES', `Iniciando. Ventana: ${hoy} → ${limite}`)

  try {
    const db = getDb()

    // Contratos cuyo fin cae dentro de la ventana de anticipación
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

      // Verificar si ya tiene una factura activa vinculada
      if (contrato.factura_id) {
        try {
          const facExist = await db.collection('facturas').doc(contrato.factura_id).get()
          if (facExist.exists) {
            const st = facExist.data().estado
            if (!['Anulada', 'Rechazada'].includes(st)) {
              omitidos++
              continue
            }
          }
        } catch {
          omitidos++
          continue
        }
      }

      // Datos del panel
      let panel = { nombre: 'Panel', ciudad: '', tipo: '', direccion: '' }
      if (contrato.panel_id) {
        try {
          const pd = await db.collection('paneles').doc(contrato.panel_id).get()
          if (pd.exists) panel = { id: pd.id, ...pd.data() }
        } catch { /* panel no encontrado */ }
      }

      // Datos del cliente
      let cliente = { empresa: 'Cliente', ruc: '', email: null, direccion: null }
      if (contrato.cliente_id) {
        try {
          const cd = await db.collection('clientes').doc(contrato.cliente_id).get()
          if (cd.exists) cliente = { id: cd.id, ...cd.data() }
        } catch { /* cliente no encontrado */ }
      }

      // Calcular importes (IGV 18%)
      const monto    = Number(contrato.monto || 0)
      const subtotal = Number((monto / 1.18).toFixed(2))
      const igv      = Number((monto - subtotal).toFixed(2))

      // Número correlativo de la serie F001
      const serie   = 'F001'
      const tipDoc  = '01'
      const lastSnap = await db.collection('facturas')
        .where('serie',    '==', serie)
        .where('tipo_doc', '==', tipDoc)
        .where('deleted',  '==', false)
        .orderBy('numero', 'desc')
        .limit(1)
        .get()

      const numero     = lastSnap.empty ? 1 : (lastSnap.docs[0].data().numero || 0) + 1
      const numero_fmt = `${serie}-${String(numero).padStart(8, '0')}`

      const nuevaFactura = {
        tipo_doc: tipDoc,
        serie,
        numero,
        numero_fmt,
        fecha_emision:     hoy,
        fecha_vencimiento: contrato.fin,
        emisor_ruc:        process.env.EMISOR_RUC,
        emisor_razon:      process.env.EMISOR_RAZON_SOCIAL,
        cliente_tipo_doc:  'RUC',
        cliente_doc:       cliente.ruc       || '',
        cliente_nombre:    cliente.empresa   || 'Cliente',
        cliente_email:     cliente.email     || null,
        cliente_direccion: cliente.direccion || null,
        cliente_id:        contrato.cliente_id || null,
        panel_id:          contrato.panel_id   || null,
        panel_nombre:      panel.nombre        || null,
        cara_panel:        contrato.cara       || null,
        periodo_inicio:    contrato.inicio     || null,
        periodo_fin:       contrato.fin        || null,
        concepto: `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} (${contrato.inicio} → ${contrato.fin})`,
        moneda:       'PEN',
        es_exonerado: false,
        subtotal,
        igv,
        total:        monto,
        op_gravada:   subtotal,
        op_exonerada: 0,
        op_inafecta:  0,
        items: [{
          orden:           1,
          descripcion:     `Arrendamiento de Panel Publicitario — ${panel.nombre || ''} · ${panel.ciudad || ''} (${contrato.inicio} → ${contrato.fin})`,
          unidad_medida:   'ZZ',
          cantidad:        1,
          precio_unitario: subtotal,
          subtotal,
          igv_item:        igv,
          total:           monto,
        }],
        estado:     'Borrador',
        deleted:    false,
        origen:     'cron_auto',
        creado_por: 'sistema',
        createdAt:  FieldValue.serverTimestamp(),
      }

      try {
        const ref = await db.collection('facturas').add(nuevaFactura)
        // Vincular el contrato con la factura recién creada
        await contratoDoc.ref.update({
          factura_id:     ref.id,
          factura_numero: numero_fmt,
          factura_estado: 'Borrador',
          updatedAt:      FieldValue.serverTimestamp(),
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
// REGISTRO DE TODOS LOS JOBS
// ══════════════════════════════════════════════════════════════════
export function iniciarCrons() {
  // Job 1 — Facturas vencidas: diario 06:00 AM Lima
  cron.schedule('0 6 * * *', marcarFacturasVencidas, { timezone: 'America/Lima' })

  // Job 2 — Paneles libres: diario 06:10 AM Lima
  cron.schedule('10 6 * * *', liberarPanelesVencidos, { timezone: 'America/Lima' })

  // Job 3 — Borradores automáticos: diario 07:00 AM Lima
  cron.schedule('0 7 * * *', generarBorradoresFactura, { timezone: 'America/Lima' })

  console.log('⏰  Crons registrados (hora Lima):')
  console.log('   · 06:00 — Marcar facturas vencidas')
  console.log('   · 06:10 — Liberar paneles sin contrato activo')
  console.log('   · 07:00 — Generar borradores de factura automáticos')
}
