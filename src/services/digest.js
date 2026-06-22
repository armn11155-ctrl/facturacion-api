import nodemailer from "nodemailer";
import { getDb } from "../lib/firebase.js";

const GMAIL_USER   = process.env.GMAIL_USER;
const GMAIL_PASS   = process.env.GMAIL_PASS;
const DIGEST_EMAIL = process.env.DIGEST_EMAIL || process.env.ADMIN_EMAIL || GMAIL_USER;
const EMISOR       = process.env.EMISOR_RAZON_SOCIAL || "8 Millas S.A.C.";
const FIRMA        = process.env.FIRMA_NOMBRE || "Alan Martínez";

const fmt = (n) => "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2 });
const hoyStr = () => new Date().toLocaleDateString("es-PE", { timeZone: "America/Lima" });
const ymd = (d) => d.toISOString().split("T")[0];

function saludo() {
  const h = Number(new Intl.DateTimeFormat("es-PE", { hour: "numeric", hour12: false, timeZone: "America/Lima" }).format(new Date()));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

// ════════════════════════════════════════════════════════════════════
// RESUMEN DIARIO PARA EL GERENTE — gratis, por correo (Gmail)
// Reúne lo que tu app ya detecta, pero te lo empuja sin abrir nada.
// ════════════════════════════════════════════════════════════════════
export async function enviarDigestDiario() {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn("[digest] Gmail no configurado — resumen omitido");
    return { ok: false };
  }

  const db = getDb();
  const hoy = ymd(new Date());
  const en30 = ymd(new Date(Date.now() + 30 * 86400000));
  const hace90 = ymd(new Date(Date.now() - 90 * 86400000));

  const getAll = async (col) => (await db.collection(col).where("deleted", "==", false).get().catch(async () => await db.collection(col).get())).docs.map((d) => ({ id: d.id, ...d.data() }));
  const [contratos, paneles, clientes, facturas] = await Promise.all([
    getAll("contratos"), getAll("paneles"), getAll("clientes"), getAll("facturas"),
  ]);

  // 1) Borradores listos para emitir
  const borradores = facturas.filter((f) => f.estado === "Borrador");

  // 2) Por cobrar (emitidas/aceptadas/vencidas no pagadas)
  const porCobrar = facturas.filter((f) => ["Emitida", "Aceptada", "Vencida"].includes(f.estado));
  const totalPorCobrar = porCobrar.reduce((s, f) => s + Number(f.total || 0), 0);

  // 3) Contratos por vencer (≤30 días) — recordatorio administrativo
  const porVencer = contratos
    .filter((c) => c.fin && c.fin >= hoy && c.fin <= en30)
    .sort((a, b) => a.fin.localeCompare(b.fin));

  // 4) Paneles libres ahora + por liberarse pronto (preventa, ≤15 días,
  // y que NO ya tengan un contrato siguiente armado para el mismo panel)
  const ocupados = new Set(contratos.filter((c) => c.fin && c.fin >= hoy).map((c) => c.panel_id));
  const libresAhora = paneles.filter((p) => !ocupados.has(p.id));

  const en15 = ymd(new Date(Date.now() + 15 * 86400000));
  const porLiberarse = contratos.filter((c) => {
    if (!c.fin || c.fin < hoy || c.fin > en15) return false;
    const yaRenovado = contratos.some((o) => o.id !== c.id && o.panel_id === c.panel_id && o.inicio > c.fin);
    return !yaRenovado;
  });

  // 5) Clientes inactivos (sin contrato reciente)
  const conActividad = new Set(contratos.filter((c) => c.fin && c.fin >= hace90).map((c) => c.cliente_id));
  const inactivos = clientes.filter((cl) => !conActividad.has(cl.id) && cl.tipo !== "Prospecto");

  // 6) Contratos vigentes sin foto de campaña reciente (+30 días o ninguna)
  const hace30 = new Date(Date.now() - 30 * 86400000);
  const contratosVigentes = contratos.filter((c) => c.inicio && c.fin && c.inicio <= hoy && c.fin >= hoy);
  const sinFotoReciente = contratosVigentes.filter((c) => {
    const fotos = c.fotos_campania || [];
    if (fotos.length === 0) return true;
    const ultima = fotos.reduce((a, f) => (f.fecha > a ? f.fecha : a), fotos[0].fecha);
    return new Date(ultima) <= hace30;
  });
  const ganadosSinContrato = clientes.filter((cl) => cl.tipo === "Prospecto" && cl.estado === "Ganado");

  // 7) Cotizaciones enviadas hace 3+ días sin que el lead avance de etapa
  const hace3dias = new Date(Date.now() - 3 * 86400000);
  const cotizacionesSinRespuesta = clientes.filter((cl) =>
    cl.tipo === "Prospecto" &&
    cl.estado === "Propuesta enviada" &&
    cl.ultima_cotizacion_at &&
    new Date(cl.ultima_cotizacion_at) <= hace3dias,
  );

  const nombreCli = (id) => clientes.find((c) => c.id === id)?.empresa || "Cliente";
  const nombrePan = (id) => paneles.find((p) => p.id === id)?.nombre || "Panel";
  const diasA = (f) => Math.round((new Date(f + "T00:00:00") - new Date(hoy + "T00:00:00")) / 86400000);

  const hayPendientes = borradores.length || porCobrar.length || porVencer.length || libresAhora.length ||
    porLiberarse.length || inactivos.length || ganadosSinContrato.length || cotizacionesSinRespuesta.length ||
    sinFotoReciente.length;

  // ── Construcción del HTML ──────────────────────────────────────────
  const tarjeta = (color, icono, titulo, valor, detalle = "") => `
    <div style="background:#fff;border:1px solid #eef1f6;border-left:4px solid ${color};border-radius:10px;padding:14px 18px;margin:0 0 12px">
      <p style="margin:0;font-size:13px;color:#888">${icono} ${titulo}</p>
      <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#111">${valor}</p>
      ${detalle ? `<div style="margin:8px 0 0;font-size:13px;color:#555;line-height:1.6">${detalle}</div>` : ""}
    </div>`;

  const listaBorradores = borradores.slice(0, 6).map((f) =>
    `• <b>${f.numero_fmt}</b> — ${f.cliente_nombre || nombreCli(f.cliente_id)}${f.periodo_mes ? ` (${f.periodo_mes})` : ""} · ${fmt(f.total)}`).join("<br/>");

  const listaVencer = porVencer.slice(0, 6).map((c) => {
    const d = diasA(c.fin);
    return `• ${nombreCli(c.cliente_id)} — ${nombrePan(c.panel_id)} · vence en <b>${d} día${d === 1 ? "" : "s"}</b> · ${fmt(c.monto)}/mes`;
  }).join("<br/>");

  const listaPaneles = [
    ...libresAhora.map((p) => `• <b>${p.nombre}</b> — libre ahora`),
    ...porLiberarse.map((c) => {
      const d = diasA(c.fin);
      return `• <b>${nombrePan(c.panel_id)}</b> — se libera en ${d} día${d === 1 ? "" : "s"}, vende antes 🔥`;
    }),
  ].slice(0, 8).join("<br/>");
  const totalPaneles = libresAhora.length + porLiberarse.length;

  const listaGanados = ganadosSinContrato.slice(0, 6).map((c) =>
    `• <b>${c.empresa}</b>${c.contacto ? ` — ${c.contacto}` : ""}`).join("<br/>");

  const listaCotizaciones = cotizacionesSinRespuesta.slice(0, 6).map((c) => {
    const d = Math.round((Date.now() - new Date(c.ultima_cotizacion_at)) / 86400000);
    return `• <b>${c.empresa}</b> — ${fmt(c.ultima_cotizacion_monto)} · enviada hace ${d} días`;
  }).join("<br/>");

  const listaSinFoto = sinFotoReciente.slice(0, 6).map((c) =>
    `• ${nombreCli(c.cliente_id)} — <b>${nombrePan(c.panel_id)}</b>`).join("<br/>");

  const secciones = [
    borradores.length ? tarjeta("#1D4ED8", "🧾", "Borradores listos para emitir", borradores.length, listaBorradores + (borradores.length > 6 ? `<br/>… y ${borradores.length - 6} más` : "")) : "",
    porCobrar.length ? tarjeta("#059669", "💰", "Por cobrar", `${porCobrar.length} · ${fmt(totalPorCobrar)}`, "Facturas emitidas pendientes de pago.") : "",
    ganadosSinContrato.length ? tarjeta("#16A34A", "🎉", "Ganados sin contrato creado", ganadosSinContrato.length, listaGanados) : "",
    cotizacionesSinRespuesta.length ? tarjeta("#DC2626", "⏳", "Cotizaciones sin respuesta (3+ días)", cotizacionesSinRespuesta.length, listaCotizaciones) : "",
    porVencer.length ? tarjeta("#D97706", "⏰", "Contratos por vencer (30 días)", porVencer.length, listaVencer + (porVencer.length > 6 ? `<br/>… y ${porVencer.length - 6} más` : "")) : "",
    totalPaneles ? tarjeta("#7C3AED", "📍", "Paneles libres / por liberarse", totalPaneles, listaPaneles + (totalPaneles > 8 ? `<br/>… y ${totalPaneles - 8} más` : "")) : "",
    sinFotoReciente.length ? tarjeta("#0891B2", "📷", "Paneles sin foto reciente (+30 días)", sinFotoReciente.length, listaSinFoto + (sinFotoReciente.length > 6 ? `<br/>… y ${sinFotoReciente.length - 6} más` : "")) : "",
    inactivos.length ? tarjeta("#6B7280", "😴", "Clientes inactivos (90 días)", inactivos.length, "Sin contratos recientes — oportunidad de reactivar.") : "",
  ].filter(Boolean).join("");

  const html = `
<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto">
    <div style="background:linear-gradient(135deg,#0F172A 0%,#1D4ED8 100%);padding:26px 30px;border-radius:14px 14px 0 0">
      <p style="margin:0;color:rgba(255,255,255,.8);font-size:11px;text-transform:uppercase;letter-spacing:2px">Vista360 · Resumen del día</p>
      <p style="margin:6px 0 0;color:#fff;font-size:21px;font-weight:800">${saludo()}, ${FIRMA}</p>
      <p style="margin:2px 0 0;color:rgba(255,255,255,.75);font-size:13px">${hoyStr()}</p>
    </div>
    <div style="background:#fff;padding:24px 22px;border-radius:0 0 14px 14px;box-shadow:0 2px 18px rgba(0,0,0,.06)">
      ${hayPendientes
        ? secciones
        : `<p style="text-align:center;color:#059669;font-size:16px;font-weight:600;padding:24px 0">✅ Todo en orden. Sin pendientes por hoy.</p>`}
      <p style="margin:18px 0 0;font-size:11px;color:#aaa;text-align:center">${EMISOR} · Reporte automático diario</p>
    </div>
  </div>
</body></html>`;

  try {
    const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_PASS } });
    await transporter.sendMail({
      from: `"Vista360" <${GMAIL_USER}>`,
      to: DIGEST_EMAIL,
      subject: `📋 Resumen Vista360 — ${hoyStr()}${hayPendientes ? "" : " · todo en orden"}`,
      html,
    });
    console.log(`[digest] ✅ Resumen diario enviado a ${DIGEST_EMAIL}`);
    return { ok: true, pendientes: !!hayPendientes };
  } catch (err) {
    console.error("[digest] ❌ Error:", err.message);
    return { ok: false, error: err.message };
  }
}
