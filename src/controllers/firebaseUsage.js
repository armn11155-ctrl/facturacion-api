/**
 * Firebase Usage Controller
 *
 * Consulta el uso REAL de Firestore usando Google Cloud Monitoring API.
 * Requiere una cuenta de servicio con rol: roles/monitoring.viewer
 *
 * GET /api/firebase/usage
 *
 * Variables de entorno:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — contenido del JSON de la cuenta de servicio
 *   FIREBASE_PROJECT_ID         — ID del proyecto Firebase (alternativa al JSON)
 */
import { createSign } from 'crypto'

// Caché en memoria: no llamar a Google más de una vez cada 10 minutos
let cache = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutos

/**
 * Genera un access token de Google OAuth usando una cuenta de servicio (JWT Grant).
 * No requiere librerías externas — usa crypto nativo de Node.js.
 */
async function getGoogleAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000)

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss:   serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url')

  const toSign    = `${header}.${payload}`
  const signer    = createSign('RSA-SHA256')
  signer.update(toSign)
  const signature = signer.sign(serviceAccount.private_key, 'base64url')
  const jwt       = `${toSign}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })

  const data = await res.json()
  if (!data.access_token) throw new Error(`OAuth error: ${JSON.stringify(data)}`)
  return data.access_token
}

/**
 * Consulta métricas de Firestore en Google Cloud Monitoring.
 * Métricas disponibles:
 *   - firestore.googleapis.com/document/count       — número de documentos
 *   - firestore.googleapis.com/storage/document_bytes — bytes de datos (solo documentos)
 *   - firestore.googleapis.com/storage/index_bytes   — bytes de índices
 */
async function queryMetric(projectId, accessToken, metricType) {
  const end   = new Date()
  const start = new Date(end - 30 * 60 * 1000) // últimos 30 min (datos pueden tener delay)

  const params = new URLSearchParams({
    filter:                   `metric.type="${metricType}"`,
    'interval.startTime':     start.toISOString(),
    'interval.endTime':       end.toISOString(),
    'aggregation.alignmentPeriod':   '3600s',
    'aggregation.perSeriesAligner':  'ALIGN_MEAN',
  })

  const res = await fetch(
    `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Monitoring API ${res.status}: ${err.slice(0, 200)}`)
  }

  const data = await res.json()
  const series = data.timeSeries ?? []

  if (series.length === 0) return null

  // Tomar el punto más reciente de todas las series (puede haber varias bases de datos)
  let total = 0
  for (const ts of series) {
    const points = ts.points ?? []
    if (points.length > 0) {
      const last = points[0].value
      total += last.int64Value
        ? parseInt(last.int64Value)
        : (last.doubleValue ?? 0)
    }
  }

  return total
}

export async function getFirebaseUsage(req, res) {
  // Devolver caché si es reciente
  if (cache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return res.json({ ok: true, ...cache, cached: true })
  }

  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!saJson) {
    return res.status(503).json({
      ok:      false,
      error:   'GOOGLE_SERVICE_ACCOUNT_JSON no configurado',
      hint:    'Agrega el JSON de la cuenta de servicio en las variables de entorno del backend',
    })
  }

  let serviceAccount
  try {
    serviceAccount = JSON.parse(saJson)
  } catch {
    return res.status(500).json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON tiene formato inválido' })
  }

  const projectId = serviceAccount.project_id || process.env.FIREBASE_PROJECT_ID
  if (!projectId) {
    return res.status(500).json({ ok: false, error: 'No se pudo determinar el project_id de Firebase' })
  }

  try {
    const accessToken = await getGoogleAccessToken(serviceAccount)

    // Consultar métricas en paralelo
    const [docCount, docBytes, indexBytes] = await Promise.allSettled([
      queryMetric(projectId, accessToken, 'firestore.googleapis.com/document/count'),
      queryMetric(projectId, accessToken, 'firestore.googleapis.com/storage/document_bytes'),
      queryMetric(projectId, accessToken, 'firestore.googleapis.com/storage/index_bytes'),
    ])

    const result = {
      ok:            true,
      projectId,
      documentCount: docCount.status  === 'fulfilled' ? docCount.value  : null,
      storageDocs:   docBytes.status  === 'fulfilled' ? docBytes.value  : null,
      storageIndex:  indexBytes.status === 'fulfilled' ? indexBytes.value : null,
      storageTotal:
        (docBytes.status  === 'fulfilled' && docBytes.value  !== null) &&
        (indexBytes.status === 'fulfilled' && indexBytes.value !== null)
          ? (docBytes.value + indexBytes.value)
          : null,
      updatedAt: new Date().toISOString(),
      // Límites del plan gratuito de Firebase
      limits: {
        storage:   1  * 1024 * 1024 * 1024, // 1 GB Firestore
        documents: 1_000_000,               // No hay límite oficial pero referencial
      },
    }

    // Guardar en caché
    cache = result
    cacheTimestamp = Date.now()

    return res.json(result)
  } catch (err) {
    console.error('[Firebase Usage]', err.message)
    return res.status(502).json({
      ok:    false,
      error: err.message,
      hint:  'Verifica que la cuenta de servicio tenga el rol roles/monitoring.viewer',
    })
  }
}
