import jwt from 'jsonwebtoken'
import { query } from '../db/pool.js'

// ── Verifica JWT (usuarios del panel web) ─────────────────────────
export const authJWT = (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Token requerido' })
  }
  try {
    const token = header.split(' ')[1]
    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado' })
  }
}

// ── Verifica API Key (Vista360 y apps externas) ───────────────────
export const authApiKey = async (req, res, next) => {
  const key = req.headers['x-api-key']
  if (!key) {
    return res.status(401).json({ ok: false, error: 'API key requerida' })
  }
  try {
    const { rows } = await query(
      `SELECT * FROM api_keys WHERE api_key = $1 AND activo = true`,
      [key]
    )
    if (!rows.length) {
      return res.status(401).json({ ok: false, error: 'API key inválida' })
    }
    // Actualizar último uso
    await query(`UPDATE api_keys SET ultimo_uso = NOW() WHERE id = $1`, [rows[0].id])
    req.apiKey = rows[0]
    next()
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al verificar API key' })
  }
}

// ── Acepta JWT o API Key ──────────────────────────────────────────
export const auth = async (req, res, next) => {
  const apiKey = req.headers['x-api-key']
  if (apiKey) return authApiKey(req, res, next)

  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return authJWT(req, res, next)

  return res.status(401).json({ ok: false, error: 'Autenticación requerida' })
}

// ── Solo admin ────────────────────────────────────────────────────
export const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Solo administradores' })
  }
  next()
}
