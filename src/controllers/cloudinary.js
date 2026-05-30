/**
 * Cloudinary Controller — Eliminación segura de imágenes
 *
 * El frontend nunca tiene el API Secret de Cloudinary.
 * Este endpoint recibe el publicId y genera la firma HMAC-SHA1
 * necesaria para llamar a la API de Cloudinary.
 *
 * POST /api/cloudinary/delete  { publicId: "vista360/boletas/abc123" }
 */
import { createHash } from 'crypto'

export async function eliminarImagen(req, res) {
  const { publicId } = req.body ?? {}

  if (!publicId || typeof publicId !== 'string') {
    return res.status(400).json({ ok: false, error: 'Campo "publicId" requerido' })
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    // No está configurado — no es error crítico, solo log
    console.warn('[Cloudinary] Variables no configuradas — imagen no eliminada:', publicId)
    return res.json({ ok: true, skipped: true, message: 'Cloudinary no configurado en el servidor' })
  }

  // Generar firma HMAC-SHA1: SHA1("public_id=X&timestamp=T" + API_SECRET)
  const timestamp = Math.floor(Date.now() / 1000)
  const toSign    = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`
  const signature = createHash('sha1').update(toSign).digest('hex')

  try {
    const controller = new AbortController()
    const timer      = setTimeout(() => controller.abort(), 10_000)

    const formData = new URLSearchParams({
      public_id: publicId,
      timestamp:  String(timestamp),
      api_key:    apiKey,
      signature,
    })

    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
      { method: 'POST', body: formData, signal: controller.signal }
    )
    clearTimeout(timer)

    const data = await cloudRes.json()

    if (!cloudRes.ok || data.result === 'not found') {
      // "not found" no es error crítico — la imagen ya no existe
      return res.json({ ok: true, result: data.result ?? 'not_found' })
    }

    return res.json({ ok: true, result: data.result })
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Timeout al contactar Cloudinary' })
    }
    console.error('[Cloudinary] Error al eliminar:', err)
    return res.status(500).json({ ok: false, error: 'Error interno al eliminar imagen' })
  }
}

/**
 * Extrae el publicId de una URL de Cloudinary.
 * Ej: "https://res.cloudinary.com/mi-cloud/image/upload/v1234/vista360/boletas/abc.jpg"
 *       → "vista360/boletas/abc"
 */
export function extractPublicId(url) {
  if (!url) return null
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}
