// ══════════════════════════════════════════════════════════════════
// PLANTILLA — Cotización con precio real (enviada por Alan desde el CRM)
// ══════════════════════════════════════════════════════════════════

function fmtPEN(n) {
  return 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildHtmlPropuesta(p) {
  const firma   = process.env.FIRMA_NOMBRE || 'Alan Martínez';
  const cargo   = process.env.FIRMA_CARGO  || 'Gerente General';
  const tel     = process.env.FIRMA_TELEFONO || '947-957-971';
  const mail    = process.env.FIRMA_EMAIL    || 'armn.101@hotmail.com';
  const emisor  = process.env.EMISOR_RAZON_SOCIAL || '8 Millas S.A.C.';
  const ruc     = process.env.EMISOR_RUC || '';

  const meses        = Number(p.meses) || 1;
  const precioMensual = Number(p.precioMensual) || 0;
  const total         = precioMensual * meses;
  const hoy           = new Date().toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
  const vence          = new Date(Date.now() + 7 * 86400000).toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Segoe UI', Arial, sans-serif; color:#1E293B; }
  .page { width:210mm; min-height:297mm; }
  .header {
    background:linear-gradient(135deg,#0F172A 0%,#1D4ED8 100%);
    padding:34px 40px; color:#fff; display:flex; justify-content:space-between; align-items:flex-start;
  }
  .wordmark { font-size:28px; font-weight:900; }
  .wordmark span { color:#93C5FD; }
  .tagline { font-size:10.5px; text-transform:uppercase; letter-spacing:2px; opacity:.75; margin-top:3px; }
  .doc-label { text-align:right; font-size:11px; opacity:.8; }
  .doc-label b { display:block; font-size:16px; margin-top:2px; }
  .body { padding:38px 44px; }
  .saludo { font-size:16px; margin-bottom:16px; }
  p.txt { font-size:13.5px; line-height:1.7; color:#334155; margin-bottom:14px; }
  .panel-card {
    background:#F8FAFC; border:1px solid #E2E8F0; border-radius:12px;
    padding:18px 20px; margin:18px 0; display:flex; justify-content:space-between; align-items:center;
  }
  .panel-card .nombre { font-size:15px; font-weight:800; color:#0F172A; }
  .panel-card .meta { font-size:12px; color:#64748B; margin-top:3px; }
  .precio-box {
    background:linear-gradient(135deg,#0F172A 0%,#1D4ED8 100%); border-radius:12px;
    padding:22px 24px; margin:22px 0; color:#fff;
  }
  .precio-row { display:flex; justify-content:space-between; font-size:13px; padding:5px 0; color:rgba(255,255,255,.85); }
  .precio-total { display:flex; justify-content:space-between; align-items:baseline; margin-top:10px; padding-top:12px; border-top:1px solid rgba(255,255,255,.2); }
  .precio-total .lbl { font-size:13px; font-weight:700; }
  .precio-total .val { font-size:26px; font-weight:900; }
  .condiciones { font-size:12px; color:#94A3B8; margin-top:8px; }
  .notas { background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:14px 18px; margin:18px 0; font-size:13px; color:#92400E; }
  .vigencia { font-size:12px; color:#94A3B8; margin:10px 0 22px; }
  .firma { margin-top:26px; font-size:13.5px; color:#334155; line-height:1.6; }
  .firma b { color:#0F172A; font-size:14.5px; }
  .footer { margin-top:40px; padding-top:14px; border-top:1px solid #E2E8F0; font-size:10px; color:#94A3B8; text-align:center; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <div class="wordmark">VISTA<span>360</span></div>
      <div class="tagline">Publicidad Exterior</div>
    </div>
    <div class="doc-label">Propuesta comercial<b>${hoy}</b></div>
  </div>
  <div class="body">
    <div class="saludo">Hola ${p.contacto || ''}${p.empresa ? `, de <b>${p.empresa}</b>` : ''}:</div>
    <p class="txt">Con gusto te compartimos la propuesta para el espacio publicitario que conversamos.</p>

    <div class="panel-card">
      <div>
        <div class="nombre">${p.panelNombre || 'Panel publicitario'}</div>
        <div class="meta">${p.panelCiudad ? p.panelCiudad : ''}${p.panelTipo ? ` · ${p.panelTipo}` : ''}${p.cara ? ` · Cara ${p.cara}` : ''}</div>
      </div>
    </div>

    <div class="precio-box">
      <div class="precio-row"><span>Precio mensual</span><span>${fmtPEN(precioMensual)}</span></div>
      <div class="precio-row"><span>Duración propuesta</span><span>${meses} mes${meses === 1 ? '' : 'es'}</span></div>
      <div class="precio-total">
        <span class="lbl">Total del periodo</span>
        <span class="val">${fmtPEN(total)}</span>
      </div>
      <div class="condiciones">Precios incluyen IGV. Sujeto a disponibilidad del espacio.</div>
    </div>

    ${p.notas ? `<div class="notas">📝 ${p.notas}</div>` : ''}

    <div class="vigencia">Esta propuesta tiene vigencia hasta el <b>${vence}</b>.</div>

    <div class="firma">
      Quedo atento a cualquier consulta.<br/><br/>
      Saludos cordiales,<br/>
      <b>${firma}</b><br/>
      ${cargo} · Vista 360<br/>
      📞 ${tel} &nbsp;·&nbsp; ✉️ ${mail}
    </div>

    <div class="footer">${emisor}${ruc ? ` · RUC ${ruc}` : ''}</div>
  </div>
</div>
</body>
</html>`;
}
