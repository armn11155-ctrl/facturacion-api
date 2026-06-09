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
import { enviarResumenDiarioCron } from '../jobs/crons.js'
import { enviarResumenDiario }     from '../services/sunat.js'

const router = Router()

// ── AUTH ──────────────────────────────────────────────────────────
router.post('/auth/login',          authCtrl.login)
router.get ('/auth/me',             authJWT, authCtrl.me)
router.post('/auth/api-keys',       authJWT, soloAdmin, authCtrl.generarApiKey)

// ── OCR — Proxy seguro a Google Cloud Vision ──────────────────────
const ocrLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Límite de escaneos alcanzado. Espera 15 minutos.' },
})
router.post('/ocr', ocrLimit, authApiKey, analizarImagen)

// ── CLOUDINARY — Eliminación segura de imágenes ───────────────────
router.post('/cloudinary/delete', authApiKey, eliminarImagen)

// ── FIREBASE USAGE ────────────────────────────────────────────────
router.get('/firebase/usage', authApiKey, getFirebaseUsage)

// ── FACTURAS ──────────────────────────────────────────────────────
router.get ('/facturas',             auth,    factCtrl.listar)
router.get ('/facturas/:id',         auth,    factCtrl.obtener)
router.get ('/facturas/:id/pdf',     auth,    factCtrl.descargarPdf)   // ?formato=a4|ticket
router.post('/facturas',             authJWT, factCtrl.crear)
router.post('/facturas/:id/emitir',  authJWT, factCtrl.emitir)
router.post('/facturas/:id/cobrar',  authJWT, factCtrl.cobrar)
router.post('/facturas/:id/anular',  authJWT, factCtrl.anular)

// ── RESUMEN DIARIO DE BOLETAS (RC) ───────────────────────────────
// POST /api/resumen-diario          → Disparo manual del RC del día anterior
// POST /api/resumen-diario/:fecha   → RC para una fecha específica (YYYY-MM-DD)
// GET  /api/resumen-diario/historial → Lista los RC enviados
router.post('/resumen-diario', authJWT, soloAdmin, async (req, res) => {
  try {
    const fecha = req.body.fecha || (() => {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })()
    const result = await enviarResumenDiario(fecha)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message })
  }
})

router.get('/resumen-diario/historial', auth, async (req, res) => {
  try {
    const db   = getDb()
    const snap = await db.collection('resumenes_diarios')
      .orderBy('createdAt', 'desc')
      .limit(30)
      .get()
    const historial = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    res.json({ ok: true, data: historial })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── CLIENTES ──────────────────────────────────────────────────────
router.get   ('/clientes',        auth,    cliCtrl.listar)
router.post  ('/clientes',        authJWT, cliCtrl.crear)
router.put   ('/clientes/:id',    authJWT, cliCtrl.actualizar)
router.delete('/clientes/:id',    authJWT, cliCtrl.eliminar)

// ── VISTA360 — Facturas por panel/cliente ─────────────────────────
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
        id:              d.id,
        numero_fmt:      f.numero_fmt,
        tipo_doc:        f.tipo_doc,
        estado:          f.estado,
        fecha_emision:   f.fecha_emision,
        cliente_nombre:  f.cliente_nombre,
        total:           f.total,
        cdr_url:         f.cdr_url  || null,
        ra_id:           f.ra_id    || null,
        ra_estado:       f.ra_estado || null,
        rc_id:           f.rc_id    || null,
        rc_declarada:    f.rc_declarada || false,
      }
    })
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

export default router
