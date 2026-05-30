import { query } from '../db/pool.js'

export const listar = async (req, res) => {
  try {
    const { q, estado } = req.query
    const conditions = ['deleted = false']
    const params = []
    let i = 1

    if (estado) { conditions.push(`estado = $${i++}`); params.push(estado) }
    if (q) {
      conditions.push(`(razon_social ILIKE $${i} OR numero_doc ILIKE $${i} OR email ILIKE $${i})`)
      params.push(`%${q}%`); i++
    }

    const { rows } = await query(
      `SELECT id, tipo_doc, numero_doc, razon_social, email, telefono, ciudad, estado, firebase_id, created_at
       FROM clientes WHERE ${conditions.join(' AND ')} ORDER BY razon_social`,
      params
    )
    res.json({ ok: true, data: rows })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}

export const crear = async (req, res) => {
  try {
    const { tipo_doc = 'RUC', numero_doc, razon_social, nombre_comercial, direccion, ciudad, email, telefono, firebase_id } = req.body
    if (!numero_doc || !razon_social) return res.status(400).json({ ok: false, error: 'RUC/DNI y razón social requeridos' })

    const { rows: [row] } = await query(
      `INSERT INTO clientes (tipo_doc, numero_doc, razon_social, nombre_comercial, direccion, ciudad, email, telefono, firebase_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tipo_doc, numero_doc, razon_social, nombre_comercial || null, direccion || null, ciudad || null, email || null, telefono || null, firebase_id || null]
    )
    res.status(201).json({ ok: true, data: row })
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ ok: false, error: 'Cliente con ese RUC/DNI ya existe' })
    res.status(500).json({ ok: false, error: err.message })
  }
}

export const actualizar = async (req, res) => {
  try {
    const { razon_social, nombre_comercial, direccion, ciudad, email, telefono, estado } = req.body
    const { rows: [row] } = await query(
      `UPDATE clientes SET razon_social=$1, nombre_comercial=$2, direccion=$3, ciudad=$4, email=$5, telefono=$6, estado=$7, updated_at=NOW()
       WHERE id=$8 AND deleted=false RETURNING *`,
      [razon_social, nombre_comercial||null, direccion||null, ciudad||null, email||null, telefono||null, estado||'Activo', req.params.id]
    )
    if (!row) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' })
    res.json({ ok: true, data: row })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
