/**
 * OCR Controller — Proxy seguro hacia Google Cloud Vision
 *
 * El frontend nunca ve la API Key de Google; todo pasa por este endpoint.
 * Acepta: POST /api/ocr  con body { image: "<base64>" }
 * Responde: { ok: true, text: "..." } | { ok: false, error: "..." }
 */

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate'
const OCR_TIMEOUT_MS = 20_000

export async function analizarImagen(req, res) {
  const { image } = req.body ?? {}

  if (!image || typeof image !== 'string') {
    return res.status(400).json({ ok: false, error: 'Campo "image" (base64) requerido' })
  }

  const key = process.env.GOOGLE_VISION_KEY
  if (!key) {
    return res.status(503).json({ ok: false, error: 'OCR no configurado en el servidor' })
  }

  // Validación de tamaño (base64 ~10 MB → imagen ~7.5 MB)
  if (image.length > 14_000_000) {
    return res.status(413).json({ ok: false, error: 'Imagen demasiado grande (máx ~10 MB)' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS)

  try {
    const visionRes = await fetch(`${VISION_URL}?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        requests: [
          {
            image: { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
            imageContext: { languageHints: ['es', 'es-PE'] },
          },
        ],
      }),
    })

    clearTimeout(timer)

    if (!visionRes.ok) {
      const errData = await visionRes.json().catch(() => ({}))
      const msg = errData?.error?.message ?? `HTTP ${visionRes.status}`
      return res.status(502).json({ ok: false, error: `Google Vision: ${msg}` })
    }

    const data = await visionRes.json()

    if (data.error) {
      return res.status(502).json({ ok: false, error: data.error.message })
    }

    const text = data.responses?.[0]?.fullTextAnnotation?.text ?? ''

    if (!text.trim()) {
      return res.status(422).json({
        ok: false,
        error: 'No se detectó texto. Verifica iluminación y enfoque.',
      })
    }

    return res.json({ ok: true, text })
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Timeout: Google Vision tardó más de 20s' })
    }
    console.error('[OCR] Error inesperado:', err)
    return res.status(500).json({ ok: false, error: 'Error interno al procesar imagen' })
  }
}
