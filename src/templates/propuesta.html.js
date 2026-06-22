// ══════════════════════════════════════════════════════════════════
// PLANTILLA — Propuesta comercial (Vista 360)
// Mismo sistema visual que la Factura Electrónica (factura.html.js):
// header con doc-box, bloques de partes, tabla de items con header
// azul, tabla de totales con fila resaltada. NO es un comprobante
// tributario — es una propuesta de venta con precio real.
// ══════════════════════════════════════════════════════════════════

const fmt = (n) => Number(n || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})

export function buildHtmlPropuesta(p) {
  const meses             = Number(p.meses) || 1
  const precioMensual     = Number(p.precioMensual) || 0
  const costoInstalacion  = Number(p.costoInstalacion) || 0
  const subtotalAlquiler  = precioMensual * meses
  const total             = subtotalAlquiler + costoInstalacion

  const hoy    = new Date().toLocaleDateString('es-PE')
  const vence  = new Date(Date.now() + 7 * 86400000).toLocaleDateString('es-PE')
  const numeroProp = `COT-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(Math.floor(Math.random() * 900) + 100)}`

  const emisorRazon = process.env.EMISOR_RAZON_SOCIAL || '8 Millas S.A.C.'
  const emisorRuc   = process.env.EMISOR_RUC || ''
  const emisorDir   = process.env.EMISOR_DIRECCION || ''
  const emisorCiu   = process.env.EMISOR_CIUDAD || ''
  const firma  = process.env.FIRMA_NOMBRE || 'Alan Martínez'
  const cargo  = process.env.FIRMA_CARGO  || 'Gerente General'
  const tel    = process.env.FIRMA_TELEFONO || '947-957-971'
  const mail   = process.env.FIRMA_EMAIL    || 'armn.101@hotmail.com'

  const itemsHtml = `
    <tr style="background:#fafafa">
      <td style="padding:7px 10px;color:#374151;font-size:10px">001</td>
      <td style="padding:7px 10px;color:#374151;font-size:10px">
        Arrendamiento de panel publicitario — ${p.panelNombre || 'Panel'}${p.panelCiudad ? `, ${p.panelCiudad}` : ''}${p.cara ? ` (Cara ${p.cara})` : ''}
      </td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">${meses}</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">S/ ${fmt(precioMensual)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:600;color:#111827;font-size:10px">S/ ${fmt(subtotalAlquiler)}</td>
    </tr>
    ${costoInstalacion > 0 ? `
    <tr style="background:#fff">
      <td style="padding:7px 10px;color:#374151;font-size:10px">002</td>
      <td style="padding:7px 10px;color:#374151;font-size:10px">Instalación (pago único)</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">1</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">S/ ${fmt(costoInstalacion)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:600;color:#111827;font-size:10px">S/ ${fmt(costoInstalacion)}</td>
    </tr>` : `
    <tr style="background:#fff">
      <td style="padding:7px 10px;color:#374151;font-size:10px" colspan="5">
        <span style="color:#16a34a;font-weight:600">✓ Instalación incluida sin costo adicional</span>
      </td>
    </tr>`}
  `

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<title>Propuesta ${numeroProp}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Inter', -apple-system, sans-serif;
    font-size: 11px; color: #111827; background: #fff;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page { width: 210mm; min-height: 297mm; padding: 0; position: relative; display: flex; flex-direction: column; }
  .header-wrap { padding: 12mm 14mm 0 14mm; }
  .content-wrap { padding: 0 14mm; flex: 1; }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; margin-bottom: 16px; width: 100%;
  }
  .company-name { font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; line-height: 1; }
  .company-name span { color: #f59e0b; }
  .company-meta { margin-top: 6px; color: #6b7280; font-size: 9.5px; line-height: 1.7; }
  .doc-box {
    border: 2px solid #1d4ed8; border-radius: 8px; padding: 12px 18px;
    text-align: center; min-width: 190px; flex-shrink: 0;
  }
  .doc-tipo { font-size: 9px; font-weight: 700; letter-spacing: .8px; color: #1d4ed8; text-transform: uppercase; }
  .doc-ruc { font-size: 10px; font-weight: 600; color: #374151; margin: 4px 0 2px; }
  .doc-numero { font-size: 16px; font-weight: 800; color: #111827; letter-spacing: -0.3px; }
  .parties { display: flex; gap: 16px; margin-bottom: 16px; }
  .party-block { flex: 1; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .party-title { font-size: 8.5px; font-weight: 700; letter-spacing: .6px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  .party-name { font-size: 12px; font-weight: 700; color: #111827; margin-bottom: 4px; }
  .party-detail { font-size: 9.5px; color: #6b7280; line-height: 1.65; }
  .meta-section { display: flex; gap: 16px; margin-bottom: 16px; }
  .meta-block { flex: 1; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
  .meta-title { font-size: 8.5px; font-weight: 700; letter-spacing: .6px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; }
  .meta-table td { padding: 3px 0; }
  .items-section { margin-bottom: 16px; }
  .items-table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
  .items-table thead { background: #1d4ed8; }
  .items-table thead th { padding: 9px 10px; text-align: left; font-size: 8.5px; font-weight: 700; color: #fff; letter-spacing: .4px; text-transform: uppercase; }
  .items-table thead th:nth-child(n+3) { text-align: right; }
  .totales-block { max-width: 280px; margin-left: auto; }
  .totales-table { width: 100%; border-collapse: collapse; }
  .totales-table tr td { padding: 5px 10px; font-size: 10.5px; }
  .totales-table tr td:last-child { text-align: right; font-weight: 600; min-width: 90px; }
  .totales-table .total-row { background: #1d4ed8; color: #fff; border-radius: 4px; }
  .totales-table .total-row td { font-size: 13px; font-weight: 800; padding: 9px 10px; }
  .vigencia-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; background: #fffbeb; border: 1px solid #fde68a;
    border-radius: 6px; margin-bottom: 12px; font-size: 9.5px; color: #92400e;
  }
  .notas-box {
    background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px;
    padding: 8px 12px; font-size: 9.5px; color: #92400e; margin-top: 12px;
  }
  .firma-block { margin-top: 18px; font-size: 10px; color: #374151; line-height: 1.7; }
  .firma-block b { color: #111827; font-size: 11px; }
  .page-footer {
    padding: 10px 14mm 10mm 14mm; border-top: 1px solid #e5e7eb;
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;
  }
  .page-footer-text { font-size: 8px; color: #9ca3af; }
</style>
</head>
<body>
<div class="page">

  <div class="header-wrap">
    <div class="header">
      <div class="logo-area">
        <div class="company-name">8<span>Millas</span></div>
        <div class="company-meta">
          ${emisorRazon} — Vista 360<br>
          ${emisorRuc ? `RUC: ${emisorRuc}<br>` : ''}
          ${emisorDir} ${emisorCiu ? '· ' + emisorCiu : ''}
        </div>
      </div>
      <div class="doc-box">
        <div class="doc-tipo">Propuesta Comercial</div>
        <div class="doc-ruc">Fecha: ${hoy}</div>
        <div class="doc-numero">${numeroProp}</div>
      </div>
    </div>
  </div>

  <div class="content-wrap">

    <div class="vigencia-bar">
      <span>📅 Propuesta válida hasta el <b>${vence}</b></span>
      <span>Precios sujetos a disponibilidad del espacio</span>
    </div>

    <div class="parties">
      <div class="party-block">
        <div class="party-title">De</div>
        <div class="party-name">Vista 360</div>
        <div class="party-detail">
          ${emisorRazon}<br>
          ${emisorRuc ? `RUC: ${emisorRuc}<br>` : ''}
          ${tel} · ${mail}
        </div>
      </div>
      <div class="party-block">
        <div class="party-title">Para</div>
        <div class="party-name">${p.empresa || p.contacto || 'Cliente'}</div>
        <div class="party-detail">
          ${p.contacto ? `${p.contacto}<br>` : ''}
          ${p.email || ''}
        </div>
      </div>
    </div>

    <div class="meta-section">
      <div class="meta-block">
        <div class="meta-title">Espacio publicitario</div>
        <table class="meta-table">
          <tr><td style="width:90px;color:#6b7280;font-size:9.5px">Panel:</td>
              <td style="font-size:9.5px;font-weight:600">${p.panelNombre || '—'}</td></tr>
          ${p.panelCiudad ? `<tr><td style="color:#6b7280;font-size:9.5px">Ciudad:</td>
              <td style="font-size:9.5px;font-weight:600">${p.panelCiudad}</td></tr>` : ''}
          ${p.panelTipo ? `<tr><td style="color:#6b7280;font-size:9.5px">Tipo:</td>
              <td style="font-size:9.5px;font-weight:600">${p.panelTipo}</td></tr>` : ''}
          ${p.cara ? `<tr><td style="color:#6b7280;font-size:9.5px">Cara:</td>
              <td style="font-size:9.5px;font-weight:600">${p.cara}</td></tr>` : ''}
        </table>
      </div>
      <div class="meta-block">
        <div class="meta-title">Condiciones</div>
        <table class="meta-table">
          <tr><td style="width:90px;color:#6b7280;font-size:9.5px">Duración:</td>
              <td style="font-size:9.5px;font-weight:600">${meses} mes${meses === 1 ? '' : 'es'}</td></tr>
          <tr><td style="color:#6b7280;font-size:9.5px">Moneda:</td>
              <td style="font-size:9.5px;font-weight:600">Soles (PEN), incluye IGV</td></tr>
        </table>
      </div>
    </div>

    <div class="items-section">
      <table class="items-table">
        <thead>
          <tr>
            <th style="width:50px">Código</th>
            <th>Descripción</th>
            <th style="width:60px">Cant.</th>
            <th style="width:90px">P. Unit.</th>
            <th style="width:90px">Total</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
    </div>

    <div class="totales-block">
      <table class="totales-table">
        <tr><td style="color:#6b7280">Alquiler (${meses} mes${meses === 1 ? '' : 'es'}):</td><td>S/ ${fmt(subtotalAlquiler)}</td></tr>
        ${costoInstalacion > 0 ? `<tr><td style="color:#6b7280">Instalación:</td><td>S/ ${fmt(costoInstalacion)}</td></tr>` : ''}
        <tr><td colspan="2" style="padding:0"><hr style="border:none;border-top:1px solid #e5e7eb;margin:6px 0"></td></tr>
        <tr class="total-row"><td>TOTAL</td><td>S/ ${fmt(total)}</td></tr>
      </table>
    </div>

    ${p.notas ? `<div class="notas-box">📝 ${p.notas}</div>` : ''}

    <div class="firma-block">
      Quedo atento a cualquier consulta.<br/><br/>
      Saludos cordiales,<br/>
      <b>${firma}</b><br/>
      ${cargo} · Vista 360<br/>
      ${tel} · ${mail}
    </div>

  </div>

  <div class="page-footer">
    <div class="page-footer-text">Propuesta comercial — no es un comprobante de pago.</div>
    <div class="page-footer-text">Vista 360 · ${emisorRazon}</div>
  </div>

</div>
</body>
</html>`
}
