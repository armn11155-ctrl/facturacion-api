import jwt from "jsonwebtoken";
import { getAuth } from "../lib/firebase.js";

// ── JWT de Firebase (facturacion-web) ─────────────────────────────
// El frontend envía Firebase ID Tokens (user.getIdToken()).
// Los verificamos con Firebase Admin SDK, no con JWT_SECRET propio.
export const authJWT = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ ok: false, error: "Token requerido" });
  try {
    const decoded = await getAuth().verifyIdToken(header.split(" ")[1]);
    req.user = { uid: decoded.uid, email: decoded.email ?? "", rol: "admin" };
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
};

// ── API Key (Vista360) ────────────────────────────────────────────
export const authApiKey = async (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ ok: false, error: "API key requerida" });

  if (key === process.env.VISTA360_API_KEY) {
    req.apiKey = { nombre: "Vista360" };
    return next();
  }
  return res.status(401).json({ ok: false, error: "API key inválida" });
};

// ── Acepta Firebase JWT o API Key ─────────────────────────────────
export const auth = async (req, res, next) => {
  if (req.headers["x-api-key"]) return authApiKey(req, res, next);
  if (req.headers.authorization?.startsWith("Bearer ")) return authJWT(req, res, next);
  return res.status(401).json({ ok: false, error: "Autenticación requerida" });
};

export const soloAdmin = (req, res, next) => {
  // Con Firebase Auth todos los usuarios autenticados son admin por ahora.
  // Ampliar con custom claims si se necesitan roles granulares.
  next();
};
