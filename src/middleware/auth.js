import jwt from "jsonwebtoken";
import { getAuth } from "../lib/firebase.js";

// ── Firebase ID Token (facturacion-web usa Firebase Auth) ─────────
// El frontend envía Firebase ID Tokens (user.getIdToken()).
// Los verificamos con Firebase Admin SDK.
export const authJWT = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ ok: false, error: "Token requerido" });

  const token = header.split(" ")[1];

  // 1) Intentar verificar como Firebase ID Token
  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.user = { uid: decoded.uid, email: decoded.email ?? "", rol: "admin" };
    return next();
  } catch {
    // No es un Firebase token — probar con JWT_SECRET (login local)
  }

  // 2) Fallback: JWT firmado con JWT_SECRET (endpoint /auth/login)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { uid: decoded.id, email: decoded.email ?? "", rol: decoded.rol ?? "vendedor" };
    return next();
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

// ── Acepta Firebase JWT, JWT local o API Key ──────────────────────
export const auth = async (req, res, next) => {
  if (req.headers["x-api-key"]) return authApiKey(req, res, next);
  if (req.headers.authorization?.startsWith("Bearer ")) return authJWT(req, res, next);
  return res.status(401).json({ ok: false, error: "Autenticación requerida" });
};

export const soloAdmin = (req, res, next) => next();
