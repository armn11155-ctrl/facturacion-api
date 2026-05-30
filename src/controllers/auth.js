import jwt from "jsonwebtoken";
import { getDb } from "../lib/firebase.js";

// Login simple con email/password guardado en Firestore colección "usuarios"
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ ok: false, error: "Email y contraseña requeridos" });

    const db   = getDb();
    const snap = await db.collection("usuarios").where("email", "==", email.toLowerCase()).limit(1).get();

    if (snap.empty)
      return res.status(401).json({ ok: false, error: "Credenciales incorrectas" });

    const user = { id: snap.docs[0].id, ...snap.docs[0].data() };

    // Comparar contraseña (bcrypt)
    const bcrypt = await import("bcryptjs");
    const ok = await bcrypt.default.compare(password, user.password_hash || "");
    if (!ok)
      return res.status(401).json({ ok: false, error: "Credenciales incorrectas" });

    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol || "vendedor" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ ok: true, token, user: { id: user.id, email: user.email, rol: user.rol } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

export const me = (req, res) => {
  res.json({ ok: true, user: req.user });
};

export const generarApiKey = (_req, res) => {
  res.json({ ok: false, error: "Usa la variable VISTA360_API_KEY del entorno" });
};
