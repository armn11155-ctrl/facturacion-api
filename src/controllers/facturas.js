import { getDb } from "../lib/firebase.js";
import { enviarASunat } from "../services/sunat.js";
import { FieldValue } from "firebase-admin/firestore";

const COL = "facturas";

// ── GET /api/facturas ─────────────────────────────────────────────
export const listar = async (req, res) => {
  try {
    const db = getDb();
    const { estado, mes, tipo_doc, limit = 50 } = req.query;

    let q = db.collection(COL).where("deleted", "==", false).orderBy("fecha_emision", "desc");

    if (estado)   q = q.where("estado", "==", estado);
    if (tipo_doc) q = q.where("tipo_doc", "==", tipo_doc);

    const snap = await q.limit(parseInt(limit)).get();
    let facturas = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (mes) facturas = facturas.filter(f => f.fecha_emision?.startsWith(mes));

    const total_facturado = facturas
      .filter(f => !["Anulada","Rechazada"].includes(f.estado))
      .reduce((s, f) => s + (f.total || 0), 0);

    res.json({ ok: true, data: facturas, kpis: { total_facturado } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── GET /api/facturas/:id ─────────────────────────────────────────
export const obtener = async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "Factura no encontrada" });
    res.json({ ok: true, data: { id: doc.id, ...doc.data() } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── POST /api/facturas ────────────────────────────────────────────
export const crear = async (req, res) => {
  try {
    const db = getDb();
    const {
      tipo_doc = "01", serie,
      cliente_tipo_doc, cliente_doc, cliente_nombre,
      cliente_email, cliente_direccion,
      panel_nombre, periodo_inicio, periodo_fin, concepto,
      moneda = "PEN", es_exonerado = false,
      fecha_emision, fecha_vencimiento,
      items = [],
    } = req.body;

    if (!items.length) return res.status(400).json({ ok: false, error: "Se requiere al menos un ítem" });
    if (!cliente_doc)  return res.status(400).json({ ok: false, error: "RUC/DNI del cliente requerido" });

    // Número correlativo — buscar el último de esta serie
    const lastSnap = await db.collection(COL)
      .where("serie", "==", serie)
      .where("tipo_doc", "==", tipo_doc)
      .where("deleted", "==", false)
      .orderBy("numero", "desc")
      .limit(1)
      .get();

    const numero = lastSnap.empty ? 1 : (lastSnap.docs[0].data().numero || 0) + 1;
    const numero_fmt = `${serie}-${String(numero).padStart(8, "0")}`;

    // Calcular totales
    let opGravada = 0, totalIgv = 0;
    const itemsCalc = items.map((item, idx) => {
      const cant     = Number(item.cantidad || 1);
      const precio   = Number(item.precio_unitario);
      const subtotal = Number((cant * precio).toFixed(2));
      const igvItem  = es_exonerado ? 0 : Number((subtotal * 0.18).toFixed(2));
      const total    = Number((subtotal + igvItem).toFixed(2));
      opGravada  += es_exonerado ? 0 : subtotal;
      totalIgv   += igvItem;
      return { orden: idx + 1, ...item, subtotal, igv_item: igvItem, total };
    });

    const subtotalTotal = Number(opGravada.toFixed(2));
    totalIgv = Number(totalIgv.toFixed(2));
    const totalFinal = Number((subtotalTotal + totalIgv).toFixed(2));

    const factura = {
      tipo_doc, serie, numero, numero_fmt,
      fecha_emision: fecha_emision || new Date().toISOString().split("T")[0],
      fecha_vencimiento: fecha_vencimiento || null,
      emisor_ruc:    process.env.EMISOR_RUC,
      emisor_razon:  process.env.EMISOR_RAZON_SOCIAL,
      cliente_tipo_doc: cliente_tipo_doc || "RUC",
      cliente_doc, cliente_nombre,
      cliente_email: cliente_email || null,
      cliente_direccion: cliente_direccion || null,
      panel_nombre: panel_nombre || null,
      periodo_inicio: periodo_inicio || null,
      periodo_fin: periodo_fin || null,
      concepto: concepto || null,
      moneda, es_exonerado,
      subtotal: subtotalTotal, igv: totalIgv, total: totalFinal,
      items: itemsCalc,
      estado: "Borrador",
      deleted: false,
      creado_por: req.user?.email || null,
      createdAt: FieldValue.serverTimestamp(),
    };

    const ref = await db.collection(COL).add(factura);
    res.status(201).json({ ok: true, data: { id: ref.id, ...factura }, mensaje: "Factura creada como Borrador" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── POST /api/facturas/:id/emitir ────────────────────────────────
export const emitir = async (req, res) => {
  try {
    const db  = getDb();
    const doc = await db.collection(COL).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ ok: false, error: "Factura no encontrada" });

    const factura = { id: doc.id, ...doc.data() };
    if (factura.estado !== "Borrador")
      return res.status(400).json({ ok: false, error: `No se puede emitir en estado "${factura.estado}"` });

    const result = await enviarASunat(req.params.id, factura, factura.items || []);

    res.json({ ok: true, mensaje: result.mensaje, data: { estado: "Emitida", cdr_url: result.cdrUrl } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── POST /api/facturas/:id/cobrar ─────────────────────────────────
export const cobrar = async (req, res) => {
  try {
    const db = getDb();
    const { metodo_pago, nro_operacion, fecha_pago, monto } = req.body;
    await db.collection(COL).doc(req.params.id).update({
      estado: "Cobrada", pagado: true,
      fecha_pago: fecha_pago || new Date().toISOString().split("T")[0],
      metodo_pago, nro_operacion: nro_operacion || null,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, mensaje: "Factura marcada como cobrada" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ── POST /api/facturas/:id/anular ─────────────────────────────────
export const anular = async (req, res) => {
  try {
    const db = getDb();
    const { motivo } = req.body;
    await db.collection(COL).doc(req.params.id).update({
      estado: "Anulada",
      sunat_mensaje: motivo || "Anulado por el usuario",
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, mensaje: "Factura anulada" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
