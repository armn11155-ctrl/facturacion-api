import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { query } from '../db/pool.js'
import crypto from 'crypto'

// ── POST /api/auth/login ──────────────────────────────────────────
export const login = async (req, res) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'Email y password requeridos' })
    }

    const { rows: [user] } = await query(
      `SELECT * FROM usuarios WHERE email = $1 AND activo = true`,
      [email.toLowerCase().trim()]
    )
    if (!user) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })

    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })

    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol, nombre: user.nombre },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    )

    res.json({
      ok: true,
      token,
      user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol },
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────
export const me = async (req, res) => {
  try {
    const { rows: [user] } = await query(
      `SELECT id, nombre, email, rol, created_at FROM usuarios WHERE id = $1`,
      [req.user.id]
    )
    res.json({ ok: true, data: user })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── POST /api/auth/api-keys — Generar API Key para Vista360 ───────
export const generarApiKey = async (req, res) => {
  try {
    const { nombre, permisos = 'lectura' } = req.body
    const apiKey = 'v360_' + crypto.randomBytes(32).toString('hex')

    const { rows: [row] } = await query(
      `INSERT INTO api_keys (nombre, api_key, permisos) VALUES ($1, $2, $3) RETURNING id, nombre, api_key, permisos, created_at`,
      [nombre, apiKey, permisos]
    )

    res.json({
      ok: true,
      data: row,
      mensaje: '⚠️ Guarda esta API Key, no se mostrará nuevamente',
    })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
