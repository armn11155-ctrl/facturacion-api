import { Router } from 'express'
import { authJWT, authApiKey, auth, soloAdmin } from '../middleware/auth.js'
import rateLimit from 'express-rate-limit'
import { getDb } from '../lib/firebase.js'

// Controllers
import * as authCtrl from '../controllers/auth.js'
import * as factCtrl from '../controllers/facturas.js'
import * as cliCtrl  from '../controllers/clientes.js'
import { analizarImagen } from '../controllers/ocr.js'
import { eliminarImagen }    from '../controllers/cloudinary.js'
import { getFirebaseUsage }  from '../controllers/firebaseUsage.js'

const router = Router()

// ── AUTH ──────────────────────────────────────────────────────────
router.post('/auth/login',          authCtrl.login)
router.get ('/auth/me',             authJWT, authCtrl.me)
router.post('/auth/api-keys',       authJWT, soloAdmin, authCtrl.generarApiKey)

// ── OCR — Proxy seguro a Google Cloud Vision ──────────────────────
// Rate limit estricto: 30 req / 15 min por IP (costo real de API)
const ocrLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Límite de escaneos alcanzado. Espera 15 minutos.' },
})
router.post('/ocr', ocrLimit, authApiKey, analizarImagen)

// ── CLOUDINARY — Eliminación segura de imágenes ───────────────────
// El frontend no tiene el API Secret; el backend firma la petición
router.post('/cloudinary/delete', authApiKey, eliminarImagen)

// ── FIREBASE USAGE — Almacenamiento real vía Cloud Monitoring ─────
// Requiere GOOGLE_SERVICE_ACCOUNT_JSON en el backend
// Resultado cacheado 10 min para no exceder cuotas de la API
router.get('/firebase/usage', authApiKey, getFirebaseUsage)

// ── FACTURAS ──────────────────────────────────────────────────────
router.get ('/facturas',            auth, factCtrl.listar)
router.get ('/facturas/:id',        auth, factCtrl.obtener)
router.post('/facturas',            authJWT, factCtrl.crear)
router.post('/facturas/:id/emitir', authJWT, factCtrl.emitir)
router.post('/facturas/:id/cobrar', authJWT, factCtrl.cobrar)
router.post('/facturas/:id/anular', authJWT, factCtrl.anular)

// ── CLIENTES ──────────────────────────────────────────────────────
router.get ('/clientes',            auth, cliCtrl.listar)
router.post('/clientes',            authJWT, cliCtrl.crear)
router.put ('/clientes/:id',        authJWT, cliCtrl.actualizar)

// ── VISTA360 — Facturas por panel/cliente ─────────────────────────
// Migrado de SQL Postgres a Firebase: ANTES llamaba a query() (que ya no
// existe) y devolvía 500 garantizado.
router.get('/vista360/facturas', authApiKey, async (req, res) => {
  try {
    const { panel_firebase_id, cliente_firebase_id, estado, limit = 20 } = req.query
    const db = getDb()

    let q = db.collection('facturas').where('deleted', '==', false)
    if (estado) q = q.where('estado', '==', estado)
    if (panel_firebase_id)    q = q.where('panel_id', '==', panel_firebase_id)
    if (cliente_firebase_id)  q = q.where('cliente_id', '==', cliente_firebase_id)

    const snap = await q.orderBy('fecha_emision', 'desc').limit(parseInt(limit)).get()
    const rows = snap.docs.map(d => {
      const f = d.data()
      return {
        id:                d.id,
        numero_fmt:        f.numero_fmt,
        tipo_doc:          f.tipo_doc,
        estado:            f.estado,
        sunat_estado:      f.sunat_estado || null,
        total:             f.total,
        moneda:            f.moneda,
        fecha_emision:     f.fecha_emision,
        fecha_vencimiento: f.fecha_vencimiento || null,
        pdf_url:           f.pdf_url || null,
        xml_url:           f.xml_url || null,
        cdr_url:           f.cdr_url || null,
        hash:              f.hash    || null,
        pagado:            f.pagado  || false,
        fecha_pago:        f.fecha_pago || null,
        cliente_nombre:    f.cliente_nombre,
        panel_nombre:      f.panel_nombre || null,
      }
    })
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── REPORTES ──────────────────────────────────────────────────────
// Migrado de SQL Postgres a Firebase: agrupamos en memoria (Firestore no
// tiene GROUP BY). Para volúmenes >5000 facturas/año habría que paginar
// o mantener un documento de resumen actualizado por trigger.
router.get('/reportes/resumen', auth, async (req, res) => {
  try {
    const anio = parseInt(req.query.anio || new Date().getFullYear())
    const db   = getDb()

    const snap = await db.collection('facturas')
      .where('deleted', '==', false)
      .where('fecha_emision', '>=', `${anio}-01-01`)
      .where('fecha_emision', '<=', `${anio}-12-31`)
      .get()

    const MESES_ES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
    const facturas = snap.docs.map(d => d.data())

    // Resumen mensual
    const porMes = new Map()
    for (const f of facturas) {
      if (['Anulada','Rechazada'].includes(f.estado)) continue
      const mes = (f.fecha_emision || '').slice(0, 7)  // YYYY-MM
      if (!mes) continue
      if (!porMes.has(mes)) {
        const mesNum = parseInt(mes.slice(5, 7))
        porMes.set(mes, {
          mes,
          mes_label:     MESES_ES[mesNum - 1] || mes,
          comprobantes:  0,
          facturado:     0,
          cobrado:       0,
          pendiente:     0,
          vencido:       0,
        })
      }
      const r = porMes.get(mes)
      r.comprobantes += 1
      r.facturado    += Number(f.total || 0)
      if (['Cobrada','Pagada'].includes(f.estado))                  r.cobrado   += Number(f.total || 0)
      if (['Emitida','Aceptada','Pendiente'].includes(f.estado))    r.pendiente += Number(f.total || 0)
      if (f.estado === 'Vencida')                                   r.vencido   += Number(f.total || 0)
    }
    const mensual = [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes))

    // Top clientes
    const porCli = new Map()
    for (const f of facturas) {
      if (['Anulada','Rechazada'].includes(f.estado)) continue
      const k = `${f.cliente_doc}|${f.cliente_nombre}`
      if (!porCli.has(k)) {
        porCli.set(k, {
          cliente_nombre: f.cliente_nombre,
          cliente_doc:    f.cliente_doc,
          comprobantes:   0,
          total_facturado: 0,
          total_cobrado:   0,
        })
      }
      const r = porCli.get(k)
      r.comprobantes    += 1
      r.total_facturado += Number(f.total || 0)
      if (['Cobrada','Pagada'].includes(f.estado)) r.total_cobrado += Number(f.total || 0)
    }
    const topClientes = [...porCli.values()]
      .sort((a, b) => b.total_facturado - a.total_facturado)
      .slice(0, 10)

    res.json({ ok: true, data: { mensual, topClientes } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── HEALTH CHECK ──────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'Facturación 8 Millas', version: '1.0.0', timestamp: new Date() })
})

export default router
