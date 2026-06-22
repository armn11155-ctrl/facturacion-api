import { Router } from 'express'
import { authJWT, authApiKey, auth, soloAdmin } from '../middleware/auth.js'
import rateLimit from 'express-rate-limit'
import { getDb } from '../lib/firebase.js'
import { verificarTrack, idFirestoreValido } from '../lib/tracking.js'

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

// ── HEALTH CHECK (warmup para Render free tier) ───────────────────
router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// ── TRACKING DE APERTURA DE CORREO ────────────────────────────────
// Llamado automáticamente cuando el cliente abre el correo (píxel 1x1).
// No requiere login, PERO exige un token firmado (?t=) para que nadie
// pueda marcar facturas como leídas con IDs arbitrarios.
router.get('/track/:facturaId', async (req, res) => {
  // Siempre responder el pixel (no romper la imagen del correo)
  const pixel = Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'
  );
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(pixel);

  const { facturaId } = req.params;
  const token = req.query.t;

  // Validaciones de seguridad: forma del ID + firma válida
  if (!idFirestoreValido(facturaId) || !verificarTrack(facturaId, token)) {
    return; // pixel ya enviado; ignorar escritura no autorizada
  }

  // Marcar como leído en background (solo si el doc existe)
  try {
    const db  = getDb();
    const ref = db.collection('facturas').doc(facturaId);
    const doc = await ref.get();
    if (!doc.exists) return;
    await ref.update({
      leido_cliente: true,
      leido_cliente_at: new Date().toISOString(),
    });
    console.log(`[track] ✅ Factura ${facturaId} marcada como leída`);
  } catch (err) {
    console.error('[track] Error al marcar leída:', err.message);
  }
})

// ── AUTH ──────────────────────────────────────────────────────────
// Límite estricto anti-fuerza-bruta en el login (sistema de dinero):
// 10 intentos por IP cada 15 min.
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos de inicio de sesión. Espera 15 minutos.' },
})
router.post('/auth/login',          loginLimit, authCtrl.login)
router.get ('/auth/me',             authJWT, authCtrl.me)
router.post('/auth/api-keys',       authJWT, soloAdmin, authCtrl.generarApiKey)

// ── OCR — Proxy seguro a Google Cloud Vision ──────────────────────
const ocrLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Límite de escaneos alcanzado. Espera 15 minutos.' },
})
router.post('/ocr', ocrLimit, authApiKey, analizarImagen)

// ── PROPUESTA COMERCIAL — Vista360 (CRM) → cliente, con precio real ──
const propuestaLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { ok: false, error: 'Límite de propuestas alcanzado. Espera 15 minutos.' },
})
router.post('/propuestas/enviar', propuestaLimit, authApiKey, async (req, res) => {
  const { enviarPropuesta } = await import('../services/email.js')
  const { email, contacto, empresa, panelNombre, panelCiudad, panelTipo, cara, precioMensual, meses, notas } = req.body || {}

  if (!email || !panelNombre || !precioMensual) {
    return res.status(400).json({ ok: false, error: 'Faltan datos: email, panelNombre y precioMensual son obligatorios' })
  }
  if (Number(precioMensual) <= 0) {
    return res.status(400).json({ ok: false, error: 'El precio mensual debe ser mayor a 0' })
  }

  const r = await enviarPropuesta({
    email, contacto, empresa, panelNombre, panelCiudad, panelTipo, cara,
    precioMensual, meses: meses || 1, notas,
  })
  if (!r.ok) return res.status(502).json({ ok: false, error: r.error })
  res.json({ ok: true, mensaje: 'Propuesta enviada' })
})

// ── PORTAL DE FACTURAS — datos del comprobante (público, token firmado) ──
// Usado por el portal branded del cliente (facturacion-web /ver/:id).
// Cargar esta página = lectura real y confiable (a diferencia del pixel):
// un proxy de correo (Apple MPP, Gmail) NO abre páginas completas, solo
// precarga imágenes <img>. Si esto se ejecutó, un humano hizo clic.
router.get('/public/facturas/:facturaId', async (req, res) => {
  const { facturaId } = req.params
  const token = req.query.t

  if (!idFirestoreValido(facturaId) || !verificarTrack(facturaId, token)) {
    return res.status(403).json({ ok: false, error: 'Enlace inválido o expirado' })
  }

  try {
    const db  = getDb()
    const ref = db.collection('facturas').doc(facturaId)
    const doc = await ref.get()
    if (!doc.exists) return res.status(404).json({ ok: false, error: 'Comprobante no encontrado' })

    const f = doc.data()

    // Lectura real y confiable: se marca cuando el cliente carga este
    // endpoint (clic deliberado), no por precarga automática de imágenes.
    const primeraVez = !f.leido_cliente
    await ref.update({
      leido_cliente: true,
      visto_portal: true,
      ...(primeraVez ? { leido_cliente_at: new Date().toISOString() } : {}),
    }).catch(() => {})

    // Solo lo necesario para mostrar el portal — nada sensible de más.
    res.json({
      ok: true,
      data: {
        id: facturaId,
        tipo_doc: f.tipo_doc,
        numero_fmt: f.numero_fmt,
        estado: f.estado,
        fecha_emision: f.fecha_emision,
        fecha_vencimiento: f.fecha_vencimiento ?? null,
        cliente_nombre: f.cliente_nombre ?? null,
        cliente_doc: f.cliente_doc ?? null,
        concepto: f.concepto ?? null,
        moneda: f.moneda ?? 'PEN',
        subtotal: f.subtotal ?? null,
        igv: f.igv ?? null,
        total: f.total ?? 0,
        emisor_razon: f.emisor_razon ?? process.env.EMISOR_RAZON_SOCIAL ?? null,
        emisor_ruc: f.emisor_ruc ?? null,
      },
    })
  } catch (err) {
    console.error('[portal] Error:', err.message)
    res.status(500).json({ ok: false, error: 'No se pudo cargar el comprobante' })
  }
})

// ── VER COMPROBANTE (clic del cliente = lectura confiable) ────────
// El cliente hace clic en "Ver comprobante" del correo → registra
// visto_cliente=true (señal mucho más confiable que el pixel) y le
// entrega el PDF. Requiere token firmado.
router.get('/ver/:facturaId', async (req, res) => {
  const { facturaId } = req.params;
  const token = req.query.t;

  if (!idFirestoreValido(facturaId) || !verificarTrack(facturaId, token)) {
    return res.status(403).send('Enlace inválido o expirado.');
  }

  try {
    const db  = getDb();
    const ref = db.collection('facturas').doc(facturaId);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).send('Comprobante no encontrado.');

    const factura = { id: doc.id, ...doc.data() };

    // Marcar como visto (clic real, confiable)
    await ref.update({
      leido_cliente: true,
      visto_cliente: true,
      leido_cliente_at: new Date().toISOString(),
    }).catch(() => {});

    // Entregar el PDF
    const { generarPdfFactura } = await import('../services/pdf.js');
    const { pdfBuffer } = await generarPdfFactura(factura);
    const tipo = factura.tipo_doc === '01' ? 'Factura' : 'Boleta';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${tipo}-${factura.numero_fmt || factura.id}.pdf"`,
      'Cache-Control': 'no-store',
    });
    return res.send(pdfBuffer);
  } catch (err) {
    console.error('[ver] Error:', err.message);
    return res.status(500).send('No se pudo generar el comprobante.');
  }
})

// ── CLOUDINARY — Eliminación segura de imágenes ───────────────────
router.post('/cloudinary/delete', authApiKey, eliminarImagen)

// ── FIREBASE USAGE ────────────────────────────────────────────────
router.get('/firebase/usage', authApiKey, getFirebaseUsage)

// ── FACTURAS ──────────────────────────────────────────────────────
router.get ('/facturas',             auth,    factCtrl.listar)
router.get ('/facturas/:id',         auth,    factCtrl.obtener)
router.get ('/facturas/:id/portal-link', authJWT, factCtrl.portalLink)
router.get ('/facturas/:id/pdf',     auth,    factCtrl.descargarPdf)   // ?formato=a4|ticket
router.post('/facturas',             authJWT, factCtrl.crear)
router.post('/facturas/:id/emitir',  authJWT, factCtrl.emitir)
router.post('/facturas/:id/reenviar-email', authJWT, factCtrl.reenviarEmail)
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

