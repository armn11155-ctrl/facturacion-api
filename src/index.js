import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import pool from './db/pool.js'
import routes from './routes/index.js'

dotenv.config()

const app  = express()
const PORT = process.env.PORT || 3000

// ── Seguridad ─────────────────────────────────────────────────────
app.use(helmet())

app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
}))

// Rate limiting general: 100 req / 15 min por IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { ok: false, error: 'Demasiadas solicitudes, intenta en 15 minutos' },
}))

// ── Parsers ───────────────────────────────────────────────────────
// OCR necesita base64 de imágenes → hasta 12 MB
app.use('/api/ocr', express.json({ limit: '12mb' }))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

// ── Logs ──────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
}

// ── Rutas ─────────────────────────────────────────────────────────
app.use('/api', routes)

// Ruta raíz
app.get('/', (req, res) => {
  res.json({
    ok:      true,
    sistema: '8 Millas — Sistema de Facturación Electrónica',
    version: '1.0.0',
    docs:    '/api/health',
  })
})

// 404
app.use((req, res) => {
  res.status(404).json({ ok: false, error: `Ruta ${req.method} ${req.path} no encontrada` })
})

// Error handler global
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err)
  res.status(500).json({ ok: false, error: 'Error interno del servidor' })
})

// ── Iniciar servidor ──────────────────────────────────────────────
async function start() {
  try {
    const client = await pool.connect()
    await client.query('SELECT NOW()')
    client.release()
    console.log('✅ Conectado a PostgreSQL')

    app.listen(PORT, () => {
      console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`)
      console.log(`📋 API disponible en http://localhost:${PORT}/api`)
      console.log(`🌍 Entorno: ${process.env.NODE_ENV || 'development'}\n`)
    })
  } catch (err) {
    console.error('❌ No se pudo conectar a la base de datos:', err.message)
    console.error('   Verifica tu .env y que PostgreSQL esté corriendo')
    process.exit(1)
  }
}

start()
