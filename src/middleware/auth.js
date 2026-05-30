import jwt from "jsonwebtoken";
import { getDb } from "../lib/firebase.js";

// ── JWT (facturacion-web) ─────────────────────────────────────────
export const authJWT = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ ok: false, error: "Token requerido" });
  try {
    req.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
};

// ── API Key (Vista360) ────────────────────────────────────────────
export const authApiKey = async (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ ok: false, error: "API key requerida" });

  // Clave estática configurada en variables de entorno
  if (key === process.env.VISTA360_API_KEY) {
    req.apiKey = { nombre: "Vista360" };
    return next();
  }
  return res.status(401).json({ ok: false, error: "API key inválida" });
};

// ── Acepta JWT o API Key ──────────────────────────────────────────
export const auth = async (req, res, next) => {
  if (req.headers["x-api-key"]) return authApiKey(req, res, next);
  if (req.headers.authorization?.startsWith("Bearer ")) return authJWT(req, res, next);
  return res.status(401).json({ ok: false, error: "Autenticación requerida" });
};

export const soloAdmin = (req, res, next) => {
  if (req.user?.rol !== "admin")
    return res.status(403).json({ ok: false, error: "Solo administradores" });
  next();
};
