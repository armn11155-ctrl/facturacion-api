// ══════════════════════════════════════════════════════════════════
// PLANTILLA — Respuesta automática a leads del formulario web
// Documento informativo de bienvenida (NO es una cotización con
// precios — esos los define el asesor según cada caso).
// ══════════════════════════════════════════════════════════════════

export function buildHtmlCotizacion(solicitud) {
  const nombre   = solicitud.contacto || 'estimado/a';
  const empresa  = solicitud.empresa || '';
  const panel    = solicitud.panelInteres || '';
  const ciudad   = solicitud.ciudad || '';
  const firma    = process.env.FIRMA_NOMBRE || 'Alan Martínez';
  const cargo    = process.env.FIRMA_CARGO  || 'Gerente General';
  const tel      = process.env.FIRMA_TELEFONO || '947-957-971';
  const mail     = process.env.FIRMA_EMAIL    || 'armn.101@hotmail.com';
  const emisor   = process.env.EMISOR_RAZON_SOCIAL || '8 Millas S.A.C.';
  const ruc      = process.env.EMISOR_RUC || '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI', Arial, sans-serif; color:#1E293B; }
  .page { width:210mm; min-height:297mm; padding:0; }
  .header {
    background:linear-gradient(135deg,#0F172A 0%,#1D4ED8 100%);
    padding:36px 40px; color:#fff;
  }
  .wordmark { font-size:30px; font-weight:900; letter-spacing:0.5px; }
  .wordmark span { color:#93C5FD; }
  .tagline { font-size:11px; text-transform:uppercase; letter-spacing:2px; opacity:.75; margin-top:4px; }
  .body { padding:40px 44px; }
  .saludo { font-size:16px; margin-bottom:18px; }
  p.txt { font-size:13.5px; line-height:1.7; color:#334155; margin-bottom:14px; }
  .interes-box {
    background:#EFF6FF; border:1px solid #BFDBFE; border-radius:10px;
    padding:14px 18px; margin:18px 0 22px; font-size:13px; color:#1E40AF;
  }
  .servicios { margin:24px 0; }
  .servicio {
    display:flex; gap:12px; align-items:flex-start; margin-bottom:14px;
  }
  .servicio .punto {
    width:8px; height:8px; border-radius:50%; background:#1D4ED8; margin-top:6px; flex-shrink:0;
  }
  .servicio .txt2 { font-size:13px; color:#475569; line-height:1.5; }
  .servicio b { color:#1E293B; }
  .siguiente {
    background:#F0FDF4; border:1px solid #BBF7D0; border-radius:10px;
    padding:16px 20px; margin:26px 0; font-size:13.5px; color:#166534; line-height:1.6;
  }
  .firma { margin-top:30px; font-size:13.5px; color:#334155; line-height:1.6; }
  .firma b { color:#0F172A; font-size:14.5px; }
  .footer {
    margin-top:50px; padding-top:16px; border-top:1px solid #E2E8F0;
    font-size:10.5px; color:#94A3B8; text-align:center;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="wordmark">VISTA<span>360</span></div>
    <div class="tagline">Publicidad Exterior</div>
  </div>
  <div class="body">
    <div class="saludo">Hola ${nombre}${empresa ? `, de <b>${empresa}</b>` : ''}:</div>

    <p class="txt">Gracias por tu interés en Vista 360. Recibimos tu solicitud y queremos contarte un poco más sobre lo que hacemos mientras coordinamos los detalles contigo.</p>

    ${panel || ciudad ? `
    <div class="interes-box">
      📍 Vimos que te interesa${panel ? `: <b>${panel}</b>` : ''}${ciudad ? ` en <b>${ciudad}</b>` : ''}.
    </div>` : ''}

    <div class="servicios">
      <div class="servicio">
        <div class="punto"></div>
        <div class="txt2"><b>Paneles publicitarios en ubicaciones estratégicas</b> — alto tráfico vehicular y peatonal, visibilidad garantizada.</div>
      </div>
      <div class="servicio">
        <div class="punto"></div>
        <div class="txt2"><b>Gestión integral</b> — desde el diseño del contrato hasta la facturación electrónica, todo formal y transparente.</div>
      </div>
      <div class="servicio">
        <div class="punto"></div>
        <div class="txt2"><b>Seguimiento de tu campaña</b> — te mantenemos al tanto del estado de tu panel durante todo el contrato.</div>
      </div>
    </div>

    <div class="siguiente">
      💬 <b>¿Qué sigue?</b> Un asesor se pondrá en contacto contigo muy pronto para conocer mejor tu necesidad y preparar una propuesta con precios ajustada a tu caso.
    </div>

    <div class="firma">
      Saludos cordiales,<br/>
      <b>${firma}</b><br/>
      ${cargo} · Vista 360<br/>
      📞 ${tel} &nbsp;·&nbsp; ✉️ ${mail}
    </div>

    <div class="footer">${emisor}${ruc ? ` · RUC ${ruc}` : ''} · Este documento es informativo, no constituye una cotización de precios.</div>
  </div>
</div>
</body>
</html>`;
}
