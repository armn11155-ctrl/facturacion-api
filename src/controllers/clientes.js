import { getDb } from "../lib/firebase.js";
import { FieldValue } from "firebase-admin/firestore";

const COL = "clientes";

export const listar = async (req, res) => {
  try {
    const db   = getDb();
    const snap = await db.collection(COL).where("deleted","==",false).orderBy("nombre","asc").get();
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

export const crear = async (req, res) => {
  try {
    const db  = getDb();
    const ref = await db.collection(COL).add({
      ...req.body,
      deleted: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    res.status(201).json({ ok: true, data: { id: ref.id, ...req.body } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

export const actualizar = async (req, res) => {
  try {
    const db = getDb();
    await db.collection(COL).doc(req.params.id).update({
      ...req.body,
      updatedAt: FieldValue.serverTimestamp(),
    });
    res.json({ ok: true, data: { id: req.params.id, ...req.body } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};
