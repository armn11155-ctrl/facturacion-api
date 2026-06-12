import nodemailer from "nodemailer";

const GMAIL_USER  = process.env.GMAIL_USER;
const GMAIL_PASS  = process.env.GMAIL_PASS;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || GMAIL_USER;
const EMISOR      = process.env.EMISOR_RAZON_SOCIAL || "8 Millas S.A.C.";
const API_URL     = (process.env.API_URL || "").replace(/\/$/, "");

const fmt = (n) =>
  "S/ " + Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2 });

function htmlFactura(factura, esAdmin = false) {
  const tipo = factura.tipo_doc === "01" ? "Factura" : "Boleta";
  const itemsHtml = (factura.items || [])
    .map(
      (it) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0">${it.descripcion || "-"}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center">${it.cantidad}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right">${fmt(it.precio_unitario)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;font-weight:600">${fmt(it.total)}</td>
      </tr>`
    )
    .join("");

  const periodoHtml =
    factura.periodo_inicio && factura.periodo_fin
      ? `<p style="margin:4px 0;color:#555">Período: <b>${factura.periodo_inicio}</b> al <b>${factura.periodo_fin}</b></p>`
      : "";

  // Píxel de tracking — solo para correo al cliente (no admin)
  const trackingPixel = !esAdmin && factura.id && API_URL
    ? `<img src="${API_URL}/api/track/${factura.id}" width="1" height="1" style="display:block" alt="" />`
    : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><title>${tipo} ${factura.numero_fmt}</title></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:Arial,sans-serif">
  <div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.08)">
    <div style="background:linear-gradient(135deg,#1D4ED8 0%,#2563EB 100%);padding:28px 32px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:10px;display:flex;align-items:center;justify-content:center">
          <span style="color:#fff;font-weight:900;font-size:16px">8M</span>
        </div>
        <div>
          <p style="margin:0;color:rgba(255,255,255,.8);font-size:12px;text-transform:uppercase;letter-spacing:1px">${EMISOR}</p>
          <p style="margin:0;color:#fff;font-size:20px;font-weight:700">${tipo} emitida ✅</p>
        </div>
      </div>
    </div>
    <div style="padding:28px 32px">
      <p style="margin:0 0 20px;font-size:15px;color:#333">
        ${esAdmin
          ? `Se emitió la ${tipo.toLowerCase()} <b>${factura.numero_fmt}</b> para el cliente <b>${factura.cliente_nombre}</b>.`
          : `Estimado/a <b>${factura.cliente_nombre}</b>, le informamos que se ha emitido el comprobante <b>${factura.numero_fmt}</b> a su nombre.`
        }
      </p>
      <div style="background:#f8fafc;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:4px 0;color:#777;font-size:13px;width:45%">Número</td>
            <td style="padding:4px 0;font-weight:700;font-size:14px">${factura.numero_fmt}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#777;font-size:13px">Fecha emisión</td>
            <td style="padding:4px 0;font-size:13px">${factura.fecha_emision || "-"}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#777;font-size:13px">Cliente</td>
            <td style="padding:4px 0;font-size:13px">${factura.cliente_nombre}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#777;font-size:13px">RUC / DNI</td>
            <td style="padding:4px 0;font-size:13px">${factura.cliente_doc}</td>
          </tr>
          ${factura.panel_nombre ? `<tr><td style="padding:4px 0;color:#777;font-size:13px">Panel</td><td style="padding:4px 0;font-size:13px">${factura.panel_nombre}${factura.cara_panel ? " — Cara " + factura.cara_panel : ""}</td></tr>` : ""}
        </table>
        ${periodoHtml}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
        <thead>
          <tr style="background:#f0f4ff">
            <th style="padding:8px 12px;text-align:left;color:#555;font-weight:600">Descripción</th>
            <th style="padding:8px 12px;text-align:center;color:#555;font-weight:600">Cant.</th>
            <th style="padding:8px 12px;text-align:right;color:#555;font-weight:600">P. Unit.</th>
            <th style="padding:8px 12px;text-align:right;color:#555;font-weight:600">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="text-align:right;font-size:13px;color:#555;margin-bottom:8px">
        ${!factura.es_exonerado
          ? `<p style="margin:2px 0">Subtotal: ${fmt(factura.subtotal)}</p>
             <p style="margin:2px 0">IGV (18%): ${fmt(factura.igv)}</p>`
          : `<p style="margin:2px 0;color:#059669">Operación exonerada de IGV</p>`
        }
        <p style="margin:8px 0 0;font-size:18px;font-weight:700;color:#1D4ED8">Total: ${fmt(factura.total)}</p>
      </div>
    </div>
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #eee;text-align:center">
      <p style="margin:0;font-size:11px;color:#aaa">${EMISOR} · RUC ${factura.emisor_ruc || ""} · Sistema de Facturación Electrónica</p>
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
        subject: `Tu ${tipo} ${factura.numero_fmt} — ${EMISOR}`,
        html:    htmlFactura(factura, false),
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
