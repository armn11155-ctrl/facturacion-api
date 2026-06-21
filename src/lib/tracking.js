import crypto from "node:crypto";

// El píxel de tracking lleva un token firmado para que nadie pueda
// marcar facturas como "leídas" llamando /track con IDs arbitrarios.
// Usa TRACK_SECRET; si no existe, cae a JWT_SECRET.
function secret() {
  return process.env.TRACK_SECRET || process.env.JWT_SECRET || "";
}

/** Firma un facturaId → token corto (hex) */
export function firmarTrack(facturaId) {
  const s = secret();
  if (!s) return ""; // sin secreto no se firma (el pixel simplemente no rastrea)
  return crypto
    .createHmac("sha256", s)
    .update(String(facturaId))
    .digest("hex")
    .slice(0, 24);
}

/** Verifica que el token corresponda al facturaId (comparación constante) */
export function verificarTrack(facturaId, token) {
  const esperado = firmarTrack(facturaId);
  if (!esperado || !token || token.length !== esperado.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
  } catch {
    return false;
  }
}

/** ¿El ID tiene forma de ID de Firestore? (20 chars alfanuméricos) */
export function idFirestoreValido(id) {
  return typeof id === "string" && /^[A-Za-z0-9]{16,30}$/.test(id);
}
