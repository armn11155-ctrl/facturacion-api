import jwt from "jsonwebtoken";
import { getAuth, getDb } from "../lib/firebase.js";

// ════════════════════════════════════════════════════════════════════
// LISTA BLANCA — espejo de las reglas de Firestore (config/allowedEmails)
// ────────────────────────────────────────────────────────────────────
// La API ya NO confía solo en que el token de Firebase sea válido:
// además exige que el correo esté autorizado, igual que firestore.rules.
// Se cachea 60s para no leer Firestore en cada request.
// ════════════════════════════════════════════════════════════════════
let _allowCache = { emails: null, admins: null, ts: 0 };
const ALLOW_TTL_MS = 60 * 1000;

async function cargarListaBlanca() {
  const ahora = Date.now();
  if (_allowCache.emails && ahora - _allowCache.ts < ALLOW_TTL_MS) return _allowCache;

  const db = getDb();
  const [allowedSnap, adminSnap] = await Promise.all([
    db.collection("config").doc("allowedEmails").get(),
    db.collection("config").doc("adminEmails").get().catch(() => null),
  ]);

  const emails = allowedSnap.exists ? (allowedSnap.data().emails || []) : [];
  // adminEmails es opcional. Si no existe, todos los autorizados son admin
  // (mantiene el comportamiento previo, pero ahora gateado por la lista blanca).
  const admins = adminSnap?.exists ? (adminSnap.data().emails || []) : null;

  _allowCache = {
    emails: emails.map((e) => String(e).toLowerCase()),
    admins: admins ? admins.map((e) => String(e).toLowerCase()) : null,
    ts: ahora,
  };
  return _allowCache;
}

function esAdmin(email, cache) {
  if (!cache.admins) return true; // sin lista de admins → autorizado = admin
  return cache.admins.includes(email);
}

// ── Firebase ID Token (facturacion-web usa Firebase Auth) ─────────
export const authJWT = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ ok: false, error: "Token requerido" });

  const token = header.split(" ")[1];

  // 1) Verificar como Firebase ID Token + chequear lista blanca
  try {
    const decoded = await getAuth().verifyIdToken(token);
    const email = String(decoded.email ?? "").toLowerCase();

    const cache = await cargarListaBlanca();
    const allowlistActiva = cache.emails.length > 0;

    // A prueba de bloqueos: si la lista blanca está vacía/ausente, se permite
    // el acceso (comportamiento previo) y se avisa. La restricción se activa
    // automáticamente en cuanto config/allowedEmails tenga correos.
    if (allowlistActiva && (!email || !cache.emails.includes(email))) {
      return res.status(403).json({ ok: false, error: "Usuario no autorizado" });
    }
    if (!allowlistActiva) {
      console.warn("[auth] config/allowedEmails vacío o ausente — acceso permitido. Configura la lista para activar la restricción.");
    }

    req.user = { uid: decoded.uid, email, rol: esAdmin(email, cache) ? "admin" : "vendedor" };
    return next();
  } catch (err) {
    // Si fue rechazo de autorización explícito, no seguir al fallback.
    if (err?.statusCode === 403) throw err;
    // No es un Firebase token válido — probar con JWT_SECRET (login local)
  }

  // 2) Fallback: JWT firmado con JWT_SECRET (endpoint /auth/login)
  try {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET no configurado");
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { uid: decoded.id, email: decoded.email ?? "", rol: decoded.rol ?? "vendedor" };
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Token inválido o expirado" });
  }
};

// ── API Key (Vista360, servicio a servicio) ──────────────────────
export const authApiKey = async (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (!key) return res.status(401).json({ ok: false, error: "API key requerida" });

  const expected = process.env.VISTA360_API_KEY;
  // Comparación en tiempo constante para evitar timing attacks
  if (expected && key.length === expected.length) {
    const a = Buffer.from(key);
    const b = Buffer.from(expected);
    const crypto = await import("node:crypto");
    if (crypto.timingSafeEqual(a, b)) {
      req.apiKey = { nombre: "Vista360" };
      return next();
    }
  }
  return res.status(401).json({ ok: false, error: "API key inválida" });
};

// ── Acepta Firebase JWT, JWT local o API Key ──────────────────────
export const auth = async (req, res, next) => {
  if (req.headers["x-api-key"]) return authApiKey(req, res, next);
  if (req.headers.authorization?.startsWith("Bearer ")) return authJWT(req, res, next);
  return res.status(401).json({ ok: false, error: "Autenticación requerida" });
};

// ── Solo administradores (o servicio con API key) ─────────────────
// FIX: antes era un no-op (dejaba pasar a todos). Ahora sí protege.
export const soloAdmin = (req, res, next) => {
  if (req.apiKey) return next();              // servicio interno (Vista360)
  if (req.user?.rol === "admin") return next();
  return res.status(403).json({ ok: false, error: "Requiere permisos de administrador" });
};
