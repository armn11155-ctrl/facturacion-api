import nodemailer from "nodemailer";
import { firmarTrack } from "../lib/tracking.js";
import { generarPdfFactura } from "./pdf.js";

const GMAIL_USER  = process.env.GMAIL_USER;
const GMAIL_PASS  = process.env.GMAIL_PASS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || GMAIL_USER;
const EMISOR      = process.env.EMISOR_RAZON_SOCIAL || "8 Millas S.A.C.";
const API_URL     = (process.env.API_URL || "").replace(/\/$/, "");

const fmt = (n) =>
  "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2 });

function saludoSegunHora() {
  const h = Number(new Intl.DateTimeFormat("es-PE", { hour: "numeric", hour12: false, timeZone: "America/Lima" }).format(new Date()));
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}

function htmlFactura(factura, esAdmin = false) {
  const tipo  = factura.tipo_doc === "01" ? "Factura" : "Boleta";
  const FIRMA = process.env.FIRMA_NOMBRE || "Alan Martínez";
  const CARGO = process.env.FIRMA_CARGO  || "Gerente General";

  // Píxel de apertura — solo correo al cliente, con token firmado
  const trackingPixel = !esAdmin && factura.id && API_URL
    ? `<img src="${API_URL}/api/track/${factura.id}?t=${firmarTrack(factura.id)}" width="1" height="1" style="display:block" alt="" />`
    : "";

  // ── Cuerpo del correo ──────────────────────────────────────────────
  let cuerpo;
  if (esAdmin) {
    // Copia de control para el gerente (informativa)
    const items = (factura.items || []).map(it =>
      `<tr>
         <td style="padding:7px 10px;border-bottom:1px solid #f1f1f1">${it.descripcion || "-"}</td>
         <td style="padding:7px 10px;border-bottom:1px solid #f1f1f1;text-align:right;font-weight:600">${fmt(it.total)}</td>
       </tr>`).join("");
    cuerpo = `
      <p style="margin:0 0 14px;font-size:15px;color:#333">Se emitió la ${tipo.toLowerCase()} <b>${factura.numero_fmt}</b> a <b>${factura.cliente_nombre}</b>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#f8fafc;border-radius:8px;overflow:hidden">
        ${items}
        <tr><td style="padding:10px;font-weight:700">Total</td>
            <td style="padding:10px;text-align:right;font-weight:700;color:#1D4ED8">${fmt(factura.total)}</td></tr>
      </table>
      <p style="margin:14px 0 0;font-size:12px;color:#999">Estado de envío al cliente: ${factura.cliente_email ? factura.cliente_email : "sin correo registrado"}</p>`;
  } else {
    // Correo elegante y breve para el cliente, firmado por el gerente
    cuerpo = `
      <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6">
        ${saludoSegunHora()}, <b>${factura.cliente_nombre}</b>:
      </p>
      <p style="margin:0 0 16px;font-size:15px;color:#333;line-height:1.6">
        Le hago llegar el comprobante correspondiente al servicio de panel publicitario.
        Lo encontrará <b>adjunto en formato PDF</b> en este mismo correo.
      </p>
      <div style="background:#f8fafc;border:1px solid #eef1f6;border-radius:10px;padding:14px 18px;margin:0 0 18px">
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#555">
          <tr><td style="padding:3px 0">Comprobante</td><td style="padding:3px 0;text-align:right;font-weight:700;color:#111">${factura.numero_fmt}</td></tr>
          <tr><td style="padding:3px 0">Fecha</td><td style="padding:3px 0;text-align:right">${factura.fecha_emision || "-"}</td></tr>
          <tr><td style="padding:3px 0">Total</td><td style="padding:3px 0;text-align:right;font-weight:700;color:#1D4ED8;font-size:16px">${fmt(factura.total)}</td></tr>
        </table>
      </div>
      <p style="margin:0 0 4px;font-size:15px;color:#333;line-height:1.6">Quedo atento a cualquier consulta.</p>
      <p style="margin:22px 0 0;font-size:14px;color:#333;line-height:1.5">Saludos cordiales,</p>
      <p style="margin:6px 0 0;font-size:15px;color:#111;font-weight:700">${FIRMA}</p>
      <p style="margin:1px 0 0;font-size:13px;color:#777">${CARGO} · ${EMISOR}</p>`;
  }

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${tipo} ${factura.numero_fmt}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 18px rgba(0,0,0,.07)">
    <div style="background:linear-gradient(135deg,#1D4ED8 0%,#2563EB 100%);padding:24px 30px">
      <p style="margin:0;color:rgba(255,255,255,.85);font-size:11px;text-transform:uppercase;letter-spacing:2px">${EMISOR}</p>
      <p style="margin:4px 0 0;color:#fff;font-size:19px;font-weight:700">${esAdmin ? `${tipo} emitida` : `${tipo} ${factura.numero_fmt}`}</p>
    </div>
    <div style="padding:28px 30px">
      ${cuerpo}
    </div>
    <div style="background:#f8fafc;padding:14px 30px;border-top:1px solid #eee;text-align:center">
      <p style="margin:0;font-size:11px;color:#aaa">${EMISOR} · RUC ${factura.emisor_ruc || ""} · Publicidad Exterior</p>
    </div>
  </div>
  ${trackingPixel}
</body>
</html>`;
}

export async function enviarCorreoFactura(factura) {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn("[email] GMAIL_USER o GMAIL_PASS no configurados — correo omitido");
    return { adminOk: false, clienteOk: false, clienteError: "Credenciales de Gmail no configuradas" };
  }

  const tipo        = factura.tipo_doc === "01" ? "Factura" : "Boleta";
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });

  // Generar el PDF para adjuntarlo (si falla, se envía sin adjunto)
  let attachments = [];
  try {
    const { pdfBuffer } = await generarPdfFactura(factura);
    if (pdfBuffer) {
      attachments = [{
        filename: `${tipo}-${factura.numero_fmt || factura.id}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      }];
    }
  } catch (err) {
    console.warn("[email] No se pudo generar el PDF para adjuntar:", err.message);
  }

  let adminOk      = false;
  let clienteOk    = false;
  let clienteError = null;

  // 1️⃣ Correo al administrador
  try {
    await transporter.sendMail({
      from:    `"${EMISOR}" <${GMAIL_USER}>`,
      to:      ADMIN_EMAIL,
      subject: `[Admin] ${tipo} ${factura.numero_fmt} — ${factura.cliente_nombre}`,
      html:    htmlFactura(factura, true),
      attachments,
    });
    adminOk = true;
    console.log(`[email] ✅ Admin notificado: ${factura.numero_fmt}`);
  } catch (err) {
    console.error("[email] ❌ Error enviando a admin:", err.message);
  }

  // 2️⃣ Correo al cliente
  if (factura.cliente_email) {
    try {
      await transporter.sendMail({
        from:    `"${EMISOR}" <${GMAIL_USER}>`,
        to:      factura.cliente_email,
        subject: `${tipo} ${factura.numero_fmt} · Servicio de panel publicitario — ${EMISOR}`,
        html:    htmlFactura(factura, false),
        attachments,
      });
      clienteOk = true;
      console.log(`[email] ✅ Cliente notificado: ${factura.cliente_email}`);
    } catch (err) {
      clienteError = err.message;
      console.error("[email] ❌ Error enviando a cliente:", err.message);
    }
  }

  return { adminOk, clienteOk, clienteError, sinEmail: !factura.cliente_email };
}

// ════════════════════════════════════════════════════════════════════
// ALERTA DE COMPROBANTE RECHAZADO POR SUNAT → al administrador
// ════════════════════════════════════════════════════════════════════
function transport() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

export async function enviarAlertaRechazo(factura, motivo = "", contexto = "Emisión") {
  if (!GMAIL_USER || !GMAIL_PASS) {
    console.warn("[email] Gmail no configurado — alerta de rechazo omitida");
    return { ok: false, error: "Gmail no configurado" };
  }
  const tipo = factura.tipo_doc === "01" ? "Factura" : "Boleta";
  try {
    await transport().sendMail({
      from: `"${EMISOR}" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `⚠️ SUNAT rechazó ${tipo} ${factura.numero_fmt || factura.id} (${contexto})`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:#DC2626;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
            <h2 style="margin:0;font-size:18px">⚠️ Comprobante rechazado por SUNAT</h2>
          </div>
          <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:24px">
            <p><b>${contexto}</b> del comprobante <b>${factura.numero_fmt || factura.id}</b> fue rechazada.</p>
            <p style="color:#555">Cliente: <b>${factura.cliente_nombre || "-"}</b><br/>
               Total: <b>S/ ${Number(factura.total || 0).toFixed(2)}</b></p>
            <div style="background:#FEF2F2;border-left:4px solid #DC2626;padding:12px 16px;margin:16px 0;border-radius:4px">
              <p style="margin:0;color:#991B1B;font-size:13px"><b>Motivo SUNAT:</b><br/>${motivo || "Sin detalle"}</p>
            </div>
            <p style="font-size:12px;color:#999">Revisa los datos del comprobante y vuelve a emitir desde el sistema.</p>
          </div>
        </div>`,
    });
    console.log(`[email] ✅ Alerta de rechazo enviada al admin: ${factura.numero_fmt || factura.id}`);
    return { ok: true };
  } catch (err) {
    console.error("[email] ❌ Error alerta de rechazo:", err.message);
    return { ok: false, error: err.message };
  }
}

// ════════════════════════════════════════════════════════════════════
// RECORDATORIO DE COBRANZA → al cliente
// fase: "previo" | "vencimiento" | "vencido"
// ════════════════════════════════════════════════════════════════════
export async function enviarRecordatorioCobranza(factura, fase = "vencimiento", dias = 0) {
  if (!GMAIL_USER || !GMAIL_PASS) return { ok: false, error: "Gmail no configurado" };
  if (!factura.cliente_email) return { ok: false, error: "Cliente sin email" };

  const tipo = factura.tipo_doc === "01" ? "Factura" : "Boleta";
  const titulos = {
    previo: `Recordatorio: tu ${tipo} ${factura.numero_fmt} vence pronto`,
    vencimiento: `Tu ${tipo} ${factura.numero_fmt} vence hoy`,
    vencido: `${tipo} ${factura.numero_fmt} vencida — pago pendiente`,
  };
  const mensajes = {
    previo: `Le recordamos que su comprobante <b>${factura.numero_fmt}</b> vence el <b>${factura.fecha_vencimiento}</b> (en ${dias} día${dias === 1 ? "" : "s"}).`,
    vencimiento: `Le recordamos que su comprobante <b>${factura.numero_fmt}</b> vence <b>hoy</b> (${factura.fecha_vencimiento}).`,
    vencido: `Su comprobante <b>${factura.numero_fmt}</b> venció el <b>${factura.fecha_vencimiento}</b> y figura como pendiente de pago (${dias} día${dias === 1 ? "" : "s"} de atraso).`,
  };
  const color = fase === "vencido" ? "#DC2626" : "#1D4ED8";

  try {
    await transport().sendMail({
      from: `"${EMISOR}" <${GMAIL_USER}>`,
      to: factura.cliente_email,
      cc: ADMIN_EMAIL,
      subject: titulos[fase] || titulos.vencimiento,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
          <div style="background:${color};color:#fff;padding:20px 24px;border-radius:10px 10px 0 0">
            <h2 style="margin:0;font-size:18px">${EMISOR}</h2>
          </div>
          <div style="border:1px solid #eee;border-top:none;border-radius:0 0 10px 10px;padding:24px">
            <p>Estimado/a <b>${factura.cliente_nombre || "cliente"}</b>,</p>
            <p>${mensajes[fase] || mensajes.vencimiento}</p>
            <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin:16px 0">
              <p style="margin:4px 0;color:#555">Comprobante: <b>${factura.numero_fmt}</b></p>
              <p style="margin:4px 0;color:#555">Monto: <b>S/ ${Number(factura.total || 0).toFixed(2)}</b></p>
            </div>
            <p style="font-size:13px;color:#777">Si ya realizó el pago, por favor ignore este mensaje. Gracias por su preferencia.</p>
          </div>
        </div>`,
    });
    console.log(`[email] ✅ Recordatorio (${fase}) enviado: ${factura.numero_fmt} → ${factura.cliente_email}`);
    return { ok: true };
  } catch (err) {
    console.error("[email] ❌ Error recordatorio cobranza:", err.message);
    return { ok: false, error: err.message };
  }
}
