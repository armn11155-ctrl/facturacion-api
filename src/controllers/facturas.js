import { query, transaction } from '../db/pool.js'
import { enviarASunat, consultarEstado } from '../services/sunat.js'

// ── GET /api/facturas ─────────────────────────────────────────────
export const listar = async (req, res) => {
  try {
    const {
      estado, mes, cliente_id, tipo_doc,
      page = 1, limit = 50, q
    } = req.query

    const conditions = ['f.deleted = false']
    const params = []
    let i = 1

    if (estado)     { conditions.push(`f.estado = $${i++}`);         params.push(estado) }
    if (tipo_doc)   { conditions.push(`f.tipo_doc = $${i++}`);       params.push(tipo_doc) }
    if (cliente_id) { conditions.push(`f.cliente_id = $${i++}`);     params.push(cliente_id) }
    if (mes)        { conditions.push(`to_char(f.fecha_emision,'YYYY-MM') = $${i++}`); params.push(mes) }
    if (q) {
      conditions.push(`(
        f.numero_fmt ILIKE $${i} OR
        f.cliente_nombre ILIKE $${i} OR
        f.cliente_doc ILIKE $${i} OR
        f.panel_nombre ILIKE $${i}
      )`)
      params.push(`%${q}%`)
      i++
    }

    const where  = conditions.join(' AND ')
    const offset = (parseInt(page) - 1) * parseInt(limit)

    const { rows: facturas } = await query(
      `SELECT
        f.id, f.tipo_doc, f.serie, f.numero, f.numero_fmt,
        f.fecha_emision, f.fecha_vencimiento,
        f.cliente_nombre, f.cliente_doc, f.cliente_tipo_doc,
        f.panel_nombre, f.concepto,
        f.subtotal, f.igv, f.total, f.moneda,
        f.es_exonerado, f.estado, f.sunat_estado,
        f.hash, f.pdf_url, f.xml_url, f.cdr_url,
        f.pagado, f.fecha_pago, f.metodo_pago,
        f.created_at
       FROM facturas f
       WHERE ${where}
       ORDER BY f.fecha_emision DESC, f.numero DESC
       LIMIT $${i} OFFSET $${i + 1}`,
      [...params, parseInt(limit), offset]
    )

    const { rows: [{ total: totalCount }] } = await query(
      `SELECT COUNT(*) AS total FROM facturas f WHERE ${where}`,
      params
    )

    // KPIs de resumen
    const { rows: [kpis] } = await query(
      `SELECT
        COUNT(*) FILTER (WHERE estado NOT IN ('Anulada','Rechazada')) AS total_comprobantes,
        COALESCE(SUM(total) FILTER (WHERE estado NOT IN ('Anulada','Rechazada')), 0) AS total_facturado,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('Cobrada','Pagada')), 0) AS total_cobrado,
        COALESCE(SUM(total) FILTER (WHERE estado IN ('Emitida','Aceptada','Pendiente')), 0) AS total_pendiente,
        COALESCE(SUM(total) FILTER (WHERE estado = 'Vencida'), 0) AS total_vencido
       FROM facturas
       WHERE deleted = false`
    )

    res.json({
      ok: true,
      data: facturas,
      kpis,
      pagination: {
        total: parseInt(totalCount),
        page:  parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(parseInt(totalCount) / parseInt(limit)),
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── GET /api/facturas/:id ─────────────────────────────────────────
export const obtener = async (req, res) => {
  try {
    const { rows: [factura] } = await query(
      `SELECT f.*, c.email AS cliente_email_crm
       FROM facturas f
       LEFT JOIN clientes c ON c.id = f.cliente_id
       WHERE f.id = $1 AND f.deleted = false`,
      [req.params.id]
    )
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' })

    const { rows: items } = await query(
      `SELECT * FROM factura_items WHERE factura_id = $1 ORDER BY orden`,
      [req.params.id]
    )

    res.json({ ok: true, data: { ...factura, items } })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── POST /api/facturas ────────────────────────────────────────────
export const crear = async (req, res) => {
  try {
    const {
      tipo_doc = '01', serie, cliente_id,
      cliente_tipo_doc, cliente_doc, cliente_nombre,
      cliente_email, cliente_direccion,
      panel_id, panel_nombre, periodo_inicio, periodo_fin, concepto,
      moneda = 'PEN', tipo_cambio = 1,
      es_exonerado = false,
      fecha_emision, fecha_vencimiento,
      items = [],
      doc_ref_tipo, doc_ref_serie, doc_ref_numero, motivo_nc,
    } = req.body

    if (!items.length) return res.status(400).json({ ok: false, error: 'Se requiere al menos un ítem' })
    if (!cliente_doc)  return res.status(400).json({ ok: false, error: 'RUC/DNI del cliente requerido' })

    const result = await transaction(async (client) => {
      // Obtener y reservar número correlativo
      const { rows: [serie_row] } = await client.query(
        `UPDATE series SET correlativo = correlativo + 1
         WHERE tipo_doc = $1 AND serie = $2 AND activo = true
         RETURNING correlativo`,
        [tipo_doc, serie]
      )
      if (!serie_row) throw new Error(`Serie ${serie} no encontrada o inactiva`)
      const numero = serie_row.correlativo

      // Calcular totales
      let opGravada = 0, opExonerada = 0, opInafecta = 0, totalIgv = 0

      const itemsCalculados = items.map((item, idx) => {
        const cant    = Number(item.cantidad || 1)
        const precio  = Number(item.precio_unitario)
        const desc    = Number(item.descuento || 0)
        const subtotal = Number(((cant * precio) - desc).toFixed(2))
        const tipoIgv  = es_exonerado ? 'EXO' : (item.tipo_igv || 'GRA')
        const pctIgv   = tipoIgv === 'GRA' ? 0.18 : 0
        const igvItem  = Number((subtotal * pctIgv).toFixed(2))
        const total    = Number((subtotal + igvItem).toFixed(2))

        if (tipoIgv === 'GRA')  opGravada  += subtotal
        if (tipoIgv === 'EXO')  opExonerada += subtotal
        if (tipoIgv === 'INA')  opInafecta  += subtotal
        totalIgv += igvItem

        return {
          orden: idx + 1,
          producto_id:    item.producto_id || null,
          descripcion:    item.descripcion,
          unidad_medida:  item.unidad_medida || 'ZZ',
          cantidad:       cant,
          precio_unitario: precio,
          descuento:      desc,
          tipo_igv:       tipoIgv,
          porcentaje_igv: tipoIgv === 'GRA' ? 18 : 0,
          igv_item:       igvItem,
          subtotal,
          total,
        }
      })

      opGravada   = Number(opGravada.toFixed(2))
      opExonerada = Number(opExonerada.toFixed(2))
      opInafecta  = Number(opInafecta.toFixed(2))
      totalIgv    = Number(totalIgv.toFixed(2))
      const subtotalTotal = Number((opGravada + opExonerada + opInafecta).toFixed(2))
      const totalFinal    = Number((subtotalTotal + totalIgv).toFixed(2))

      // Insertar factura
      const { rows: [factura] } = await client.query(
        `INSERT INTO facturas (
          tipo_doc, serie, numero,
          fecha_emision, fecha_vencimiento,
          emisor_ruc, emisor_razon,
          cliente_id, cliente_tipo_doc, cliente_doc, cliente_nombre,
          cliente_email, cliente_direccion,
          panel_id, panel_nombre, periodo_inicio, periodo_fin, concepto,
          moneda, tipo_cambio, es_exonerado,
          subtotal, igv, total,
          op_gravada, op_exonerada, op_inafecta,
          doc_ref_tipo, doc_ref_serie, doc_ref_numero, motivo_nc,
          estado, usuario_id
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
          $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,'Borrador',$32
        ) RETURNING *`,
        [
          tipo_doc, serie, numero,
          fecha_emision || new Date().toISOString().split('T')[0],
          fecha_vencimiento || null,
          process.env.EMISOR_RUC, process.env.EMISOR_RAZON_SOCIAL,
          cliente_id || null, cliente_tipo_doc || 'RUC', cliente_doc, cliente_nombre,
          cliente_email || null, cliente_direccion || null,
          panel_id || null, panel_nombre || null,
          periodo_inicio || null, periodo_fin || null, concepto || null,
          moneda, tipo_cambio, es_exonerado,
          subtotalTotal, totalIgv, totalFinal,
          opGravada, opExonerada, opInafecta,
          doc_ref_tipo || null, doc_ref_serie || null,
          doc_ref_numero || null, motivo_nc || null,
          req.user?.id || null,
        ]
      )

      // Insertar items
      for (const item of itemsCalculados) {
        await client.query(
          `INSERT INTO factura_items
            (factura_id, orden, producto_id, descripcion, unidad_medida,
             cantidad, precio_unitario, descuento, tipo_igv, porcentaje_igv,
             igv_item, subtotal, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            factura.id, item.orden, item.producto_id, item.descripcion,
            item.unidad_medida, item.cantidad, item.precio_unitario,
            item.descuento, item.tipo_igv, item.porcentaje_igv,
            item.igv_item, item.subtotal, item.total,
          ]
        )
      }

      return { ...factura, items: itemsCalculados }
    })

    res.status(201).json({ ok: true, data: result, mensaje: 'Factura creada como Borrador' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── POST /api/facturas/:id/emitir — Enviar a SUNAT ────────────────
export const emitir = async (req, res) => {
  try {
    const { rows: [factura] } = await query(
      `SELECT * FROM facturas WHERE id = $1 AND deleted = false`,
      [req.params.id]
    )
    if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' })
    if (!['Borrador'].includes(factura.estado)) {
      return res.status(400).json({ ok: false, error: `No se puede emitir una factura en estado "${factura.estado}"` })
    }

    const { rows: items } = await query(
      `SELECT * FROM factura_items WHERE factura_id = $1 ORDER BY orden`,
      [req.params.id]
    )

    const result = await enviarASunat(req.params.id, factura, items)

    res.json({
      ok:      true,
      mensaje: result.mensaje,
      data: {
        estado:      'Emitida',
        sunat_estado: 'Aceptado',
        cdr_url:     result.cdrUrl,
        hash:        result.data?.arcCdr || '',
      },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── POST /api/facturas/:id/cobrar ─────────────────────────────────
export const cobrar = async (req, res) => {
  try {
    const { metodo_pago, nro_operacion, fecha_pago, banco, monto, nota } = req.body

    await transaction(async (client) => {
      await client.query(
        `UPDATE facturas SET
          estado = 'Cobrada', pagado = true,
          fecha_pago = $2, metodo_pago = $3, nro_operacion = $4,
          updated_at = NOW()
         WHERE id = $1`,
        [req.params.id, fecha_pago || new Date().toISOString().split('T')[0], metodo_pago, nro_operacion || null]
      )
      await client.query(
        `INSERT INTO pagos (factura_id, monto, metodo, nro_operacion, fecha_pago, banco, nota, usuario_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [req.params.id, monto, metodo_pago, nro_operacion || null, fecha_pago || new Date().toISOString().split('T')[0], banco || null, nota || null, req.user?.id || null]
      )
    })

    res.json({ ok: true, mensaje: 'Factura marcada como cobrada' })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}

// ── DELETE /api/facturas/:id — Anular ────────────────────────────
export const anular = async (req, res) => {
  try {
    const { motivo } = req.body
    await query(
      `UPDATE facturas SET estado = 'Anulada', sunat_mensaje = $2, updated_at = NOW() WHERE id = $1`,
      [req.params.id, motivo || 'Anulado por el usuario']
    )
    res.json({ ok: true, mensaje: 'Factura anulada' })
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message })
  }
}
