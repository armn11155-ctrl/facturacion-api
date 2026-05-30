import { Router } from 'express'
import { authJWT, authApiKey, auth, soloAdmin } from '../middleware/auth.js'
import rateLimit from 'express-rate-limit'

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
router.get('/vista360/facturas', authApiKey, async (req, res) => {
  try {
    const { panel_firebase_id, cliente_firebase_id, estado, limit = 20 } = req.query
    const conditions = ['f.deleted = false']
    const params = []
    let i = 1

    if (panel_firebase_id) { conditions.push(`p.firebase_id = $${i++}`); params.push(panel_firebase_id) }
    if (cliente_firebase_id) { conditions.push(`c.firebase_id = $${i++}`); params.push(cliente_firebase_id) }
    if (estado) { conditions.push(`f.estado = $${i++}`); params.push(estado) }

    const { rows } = await query(
      `SELECT f.id, f.numero_fmt, f.tipo_doc, f.estado, f.sunat_estado,
              f.total, f.moneda, f.fecha_emision, f.fecha_vencimiento,
              f.pdf_url, f.xml_url, f.cdr_url, f.hash,
              f.pagado, f.fecha_pago,
              f.cliente_nombre, f.panel_nombre
       FROM facturas f
       LEFT JOIN paneles p  ON p.id = f.panel_id
       LEFT JOIN clientes c ON c.id = f.cliente_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY f.fecha_emision DESC
       LIMIT $${i}`,
      [...params, parseInt(limit)]
    )
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
})

// ── REPORTES ──────────────────────────────────────────────────────
router.get('/reportes/resumen', auth, async (req, res) => {
  try {
    const { anio = new Date().getFullYear() } = req.query

    const { rows: mensual } = await query(
      `SELECT
        to_char(fecha_emision, 'YYYY-MM') AS mes,
        to_char(fecha_emision, 'Mon')     AS mes_label,
        COUNT(*) AS comprobantes,
        SUM(total) AS facturado,
        SUM(total) FILTER (WHERE estado IN ('Cobrada','Pagada')) AS cobrado,
        SUM(total) FILTER (WHERE estado IN ('Emitida','Aceptada','Pendiente')) AS pendiente,
        SUM(total) FILTER (WHERE estado = 'Vencida') AS vencido
       FROM facturas
       WHERE deleted = false
         AND EXTRACT(YEAR FROM fecha_emision) = $1
         AND estado NOT IN ('Anulada','Rechazada')
       GROUP BY 1, 2
       ORDER BY 1`,
      [parseInt(anio)]
    )

    const { rows: topClientes } = await query(
      `SELECT
        cliente_nombre, cliente_doc,
        COUNT(*) AS comprobantes,
        SUM(total) AS total_facturado,
        SUM(total) FILTER (WHERE estado IN ('Cobrada','Pagada')) AS total_cobrado
       FROM facturas
       WHERE deleted = false AND estado NOT IN ('Anulada','Rechazada')
       GROUP BY cliente_nombre, cliente_doc
       ORDER BY total_facturado DESC
       LIMIT 10`
    )

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
