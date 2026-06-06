// ══════════════════════════════════════════════════════════════════
// TEMPLATE HTML — Factura Electrónica 8 Millas
// Formato A4 · UBL 2.1 · SUNAT Perú
// ══════════════════════════════════════════════════════════════════

const montoEnLetras = (total) => {
  const entero = Math.floor(total)
  const centavos = Math.round((total - entero) * 100)
  return `SON: ${entero.toString()} CON ${String(centavos).padStart(2, '0')}/100 SOLES`
}

const fmt = (n) => Number(n || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})

const tipoDocLabel = (codigo) => ({
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA ELECTRÓNICA',
  '07': 'NOTA DE CRÉDITO ELECTRÓNICA',
}[codigo] || 'COMPROBANTE ELECTRÓNICO')

const estadoBadge = (estado) => {
  const map = {
    'Borrador':  ['#94a3b8', '#f8fafc'],
    'Emitida':   ['#3b82f6', '#eff6ff'],
    'Aceptada':  ['#22c55e', '#f0fdf4'],
    'Cobrada':   ['#10b981', '#ecfdf5'],
    'Rechazada': ['#ef4444', '#fef2f2'],
    'Anulada':   ['#6b7280', '#f9fafb'],
  }
  const [color, bg] = map[estado] || ['#6b7280', '#f9fafb']
  return `<span style="background:${bg};color:${color};border:1px solid ${color}30;
    padding:2px 10px;border-radius:99px;font-size:9px;font-weight:700;letter-spacing:.5px">
    ${estado.toUpperCase()}
  </span>`
}

export function buildHtmlFactura(f, qrDataUrl) {
  const tipoLabel = tipoDocLabel(f.tipo_doc)
  const numeroFmt = f.numero_fmt || `${f.serie}-${String(f.numero).padStart(8, '0')}`

  const itemsHtml = (f.items || []).map((item, i) => `
    <tr style="${i % 2 === 0 ? 'background:#fafafa' : 'background:#fff'}">
      <td style="padding:7px 10px;color:#374151;font-size:10px">${item.codigo || String(i + 1).padStart(3, '0')}</td>
      <td style="padding:7px 10px;color:#374151;font-size:10px">${item.descripcion}</td>
      <td style="padding:7px 10px;text-align:center;color:#374151;font-size:10px">${item.unidad_medida || 'ZZ'}</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">${fmt(item.cantidad)}</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">S/ ${fmt(item.precio_unitario)}</td>
      <td style="padding:7px 10px;text-align:right;color:#374151;font-size:10px">S/ ${fmt(item.igv_item)}</td>
      <td style="padding:7px 10px;text-align:right;font-weight:600;color:#111827;font-size:10px">S/ ${fmt(item.total)}</td>
    </tr>
  `).join('')

  const periodoHtml = f.periodo_inicio && f.periodo_fin ? `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:10px;width:130px">Período:</td>
      <td style="padding:4px 0;color:#111827;font-size:10px;font-weight:500">
        ${f.periodo_inicio} al ${f.periodo_fin}
      </td>
    </tr>` : ''

  const panelHtml = f.panel_nombre ? `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:10px">Panel:</td>
      <td style="padding:4px 0;color:#111827;font-size:10px;font-weight:500">
        ${f.panel_nombre}${f.cara_panel ? ` — Cara ${f.cara_panel}` : ''}
      </td>
    </tr>` : ''

  const conceptoHtml = f.concepto ? `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:10px">Concepto:</td>
      <td style="padding:4px 0;color:#111827;font-size:10px;font-weight:500">${f.concepto}</td>
    </tr>` : ''

  const vctoHtml = f.fecha_vencimiento ? `
    <tr>
      <td style="padding:4px 0;color:#6b7280;font-size:10px">Vencimiento:</td>
      <td style="padding:4px 0;color:#111827;font-size:10px;font-weight:500">${f.fecha_vencimiento}</td>
    </tr>` : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>${tipoLabel} ${numeroFmt}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      font-size: 11px;
      color: #111827;
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { width: 210mm; min-height: 297mm; padding: 12mm 14mm 10mm; position: relative; }

    .header {
      display: flex; justify-content: space-between; align-items: flex-start;
      padding-bottom: 14px; border-bottom: 2px solid #e5e7eb; margin-bottom: 16px;
    }
    .company-name { font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; line-height: 1; }
    .company-name span { color: #f59e0b; }
    .company-meta { margin-top: 6px; color: #6b7280; font-size: 9.5px; line-height: 1.7; }
    .doc-box { border: 2px solid #1d4ed8; border-radius: 8px; padding: 12px 18px; text-align: center; min-width: 180px; }
    .doc-tipo { font-size: 9px; font-weight: 700; letter-spacing: .8px; color: #1d4ed8; text-transform: uppercase; }
    .doc-ruc { font-size: 10px; font-weight: 600; color: #374151; margin: 4px 0 2px; }
    .doc-numero { font-size: 18px; font-weight: 800; color: #111827; letter-spacing: -0.5px; }

    .parties { display: flex; gap: 16px; margin-bottom: 16px; }
    .party-block { flex: 1; background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
    .party-title { font-size: 8.5px; font-weight: 700; letter-spacing: .6px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
    .party-name { font-size: 12px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .party-detail { font-size: 9.5px; color: #6b7280; line-height: 1.65; }

    .meta-section { display: flex; gap: 16px; margin-bottom: 16px; }
    .meta-block { flex: 1; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 14px; }
    .meta-title { font-size: 8.5px; font-weight: 700; letter-spacing: .6px; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; }
    .meta-table td { padding: 3px 0; }

    .items-section { margin-bottom: 20px; }
    .items-table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
    .items-table thead { background: #1d4ed8; }
    .items-table thead th { padding: 9px 10px; text-align: left; font-size: 8.5px; font-weight: 700; color: #fff; letter-spacing: .4px; text-transform: uppercase; }
    .items-table thead th:nth-child(n+4) { text-align: right; }

    /* ── FOOTER: QR grande + Totales ── */
    .footer-area {
      display: flex;
      gap: 20px;
      align-items: flex-start;
      margin-top: 8px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
    }

    /* QR más grande y bien ubicado */
    .qr-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 14px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #fff;
      min-width: 190px;
    }
    .qr-block img {
      width: 160px;
      height: 160px;
      display: block;
      image-rendering: pixelated;
    }
    .qr-label {
      font-size: 7.5px;
      color: #9ca3af;
      text-align: center;
      line-height: 1.5;
      max-width: 160px;
    }
    .qr-label strong { color: #6b7280; }

    .totales-block { flex: 1; }
    .letras-box {
      background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;
      padding: 8px 12px; font-size: 9.5px; color: #0369a1; font-weight: 600; margin-bottom: 10px;
    }
    .totales-table { width: 100%; border-collapse: collapse; }
    .totales-table tr td { padding: 5px 10px; font-size: 10.5px; }
    .totales-table tr td:last-child { text-align: right; font-weight: 600; min-width: 90px; }
    .totales-table .total-row { background: #1d4ed8; color: #fff; border-radius: 4px; }
    .totales-table .total-row td { font-size: 13px; font-weight: 800; padding: 9px 10px; }

    .estado-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding: 6px 12px; background: #f9fafb; border: 1px solid #e5e7eb;
      border-radius: 6px; margin-bottom: 12px;
    }
    .watermark {
      position: fixed; top: 50%; left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 90px; font-weight: 900; color: rgba(239,68,68,0.08);
      letter-spacing: 8px; pointer-events: none; z-index: 0; white-space: nowrap;
    }
    .page-footer {
      margin-top: 16px; padding-top: 10px; border-top: 1px solid #e5e7eb;
      display: flex; justify-content: space-between; align-items: center;
    }
    .page-footer-text { font-size: 8px; color: #9ca3af; }
  </style>
</head>
<body>
<div class="page">

  ${['Anulada', 'Rechazada'].includes(f.estado) ? `<div class="watermark">${f.estado.toUpperCase()}</div>` : ''}

  <!-- HEADER -->
  <div class="header">
    <div class="logo-area">
      <div class="company-name">8<span>Millas</span></div>
      <div class="company-meta">
        ${process.env.EMISOR_RAZON_SOCIAL || f.emisor_razon || '—'}<br>
        RUC: ${f.emisor_ruc}<br>
        ${process.env.EMISOR_DIRECCION || ''} ${process.env.EMISOR_CIUDAD ? '· ' + process.env.EMISOR_CIUDAD : ''}
      </div>
    </div>
    <div class="doc-box">
      <div class="doc-tipo">${tipoLabel}</div>
      <div class="doc-ruc">RUC: ${f.emisor_ruc}</div>
      <div class="doc-numero">${numeroFmt}</div>
    </div>
  </div>

  <!-- ESTADO -->
  <div class="estado-bar">
    <span style="font-size:9.5px;color:#6b7280">
      Estado:&nbsp;&nbsp;${estadoBadge(f.estado)}
    </span>
    ${f.sunat_estado ? `<span style="font-size:9px;color:#6b7280">SUNAT: <strong>${f.sunat_estado}</strong></span>` : ''}
    ${f.hash ? `<span style="font-size:8px;color:#9ca3af;font-family:monospace">Hash: ${String(f.hash).substring(0, 20)}…</span>` : ''}
  </div>

  <!-- PARTES -->
  <div class="parties">
    <div class="party-block">
      <div class="party-title">Emisor</div>
      <div class="party-name">${f.emisor_razon || process.env.EMISOR_RAZON_SOCIAL}</div>
      <div class="party-detail">
        RUC: ${f.emisor_ruc}<br>
        ${process.env.EMISOR_DIRECCION || ''}<br>
        ${process.env.EMISOR_CIUDAD || ''}
      </div>
    </div>
    <div class="party-block">
      <div class="party-title">Cliente / Receptor</div>
      <div class="party-name">${f.cliente_nombre}</div>
      <div class="party-detail">
        ${f.cliente_tipo_doc || 'RUC'}: ${f.cliente_doc}<br>
        ${f.cliente_direccion ? f.cliente_direccion + '<br>' : ''}
        ${f.cliente_email || ''}
      </div>
    </div>
  </div>

  <!-- DATOS -->
  <div class="meta-section">
    <div class="meta-block">
      <div class="meta-title">Datos del comprobante</div>
      <table class="meta-table">
        <tr>
          <td style="width:130px;color:#6b7280;font-size:9.5px">Fecha de emisión:</td>
          <td style="font-size:9.5px;font-weight:600">${f.fecha_emision}</td>
        </tr>
        ${vctoHtml}
        <tr>
          <td style="color:#6b7280;font-size:9.5px">Moneda:</td>
          <td style="font-size:9.5px;font-weight:600">SOLES (PEN)</td>
        </tr>
        <tr>
          <td style="color:#6b7280;font-size:9.5px">Tipo operación:</td>
          <td style="font-size:9.5px;font-weight:600">${f.es_exonerado ? 'Exonerada' : 'Gravada (IGV 18%)'}</td>
        </tr>
      </table>
    </div>
    ${f.panel_nombre || f.concepto || f.periodo_inicio ? `
    <div class="meta-block">
      <div class="meta-title">Detalle de servicio</div>
      <table class="meta-table">
        ${panelHtml}
        ${periodoHtml}
        ${conceptoHtml}
      </table>
    </div>` : ''}
  </div>

  <!-- ITEMS -->
  <div class="items-section">
    <table class="items-table">
      <thead>
        <tr>
          <th style="width:60px">Código</th>
          <th>Descripción</th>
          <th style="width:50px;text-align:center">U.M.</th>
          <th style="width:55px;text-align:right">Cant.</th>
          <th style="width:75px;text-align:right">P. Unit.</th>
          <th style="width:65px;text-align:right">IGV</th>
          <th style="width:80px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>
  </div>

  <!-- FOOTER: QR + TOTALES -->
  <div class="footer-area">

    <!-- QR SUNAT — 160×160px, legible con cualquier escáner -->
    <div class="qr-block">
      <img src="${qrDataUrl}" alt="Código QR SUNAT" />
      <div class="qr-label">
        Representación impresa de<br>comprobante electrónico.<br>
        Consulte en <strong>sunat.gob.pe</strong>
      </div>
    </div>

    <!-- TOTALES -->
    <div class="totales-block">
      <div class="letras-box">${montoEnLetras(f.total)}</div>
      <table class="totales-table">
        ${!f.es_exonerado ? `
        <tr>
          <td style="color:#6b7280">Op. Gravada:</td>
          <td>S/ ${fmt(f.op_gravada || f.subtotal)}</td>
        </tr>` : `
        <tr>
          <td style="color:#6b7280">Op. Exonerada:</td>
          <td>S/ ${fmt(f.op_exonerada || f.subtotal)}</td>
        </tr>`}
        <tr>
          <td style="color:#6b7280">IGV (18%):</td>
          <td>S/ ${fmt(f.igv)}</td>
        </tr>
        ${f.descuento > 0 ? `
        <tr>
          <td style="color:#ef4444">Descuento:</td>
          <td style="color:#ef4444">- S/ ${fmt(f.descuento)}</td>
        </tr>` : ''}
        <tr>
          <td colspan="2" style="padding:0">
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:6px 0">
          </td>
        </tr>
        <tr class="total-row">
          <td>TOTAL A PAGAR</td>
          <td>S/ ${fmt(f.total)}</td>
        </tr>
      </table>
    </div>
  </div>

  <!-- PIE DE PÁGINA -->
  <div class="page-footer">
    <div class="page-footer-text">
      Comprobante emitido electrónicamente · R.S. 097-2012/SUNAT · ${f.emisor_ruc}
    </div>
    <div class="page-footer-text">
      ${f.cdr_url ? `Consultar en: ${f.cdr_url}` : 'Sistema de Facturación Electrónica 8 Millas v2.0'}
    </div>
  </div>

</div>
</body>
</html>`
}
