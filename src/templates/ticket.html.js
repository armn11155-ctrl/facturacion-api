// ══════════════════════════════════════════════════════════════════
// TEMPLATE HTML — Ticket Térmico 80mm (58mm de área imprimible)
// Para impresoras POS (Epson, Bixolon, Star, etc.)
// Compatible con ESC/POS vía navegador o PDF a 80mm
// ══════════════════════════════════════════════════════════════════

const fmt = (n) => Number(n || 0).toLocaleString('es-PE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
})

const tipoDocLabel = (codigo) => ({
  '01': 'FACTURA ELECTRÓNICA',
  '03': 'BOLETA DE VENTA',
  '07': 'NOTA DE CRÉDITO',
  '08': 'NOTA DE DÉBITO',
}[codigo] || 'COMPROBANTE')

export function buildHtmlTicket(f, qrDataUrl) {
  const tipoLabel = tipoDocLabel(f.tipo_doc)
  const numeroFmt = f.numero_fmt || `${f.serie}-${String(f.numero).padStart(8, '0')}`

  const itemsHtml = (f.items || []).map((item) => `
    <tr>
      <td style="padding:1px 0;font-size:11px;word-break:break-word">${item.descripcion}</td>
    </tr>
    <tr>
      <td style="padding:1px 0;font-size:11px">
        <span>${Number(item.cantidad)} x S/${fmt(item.precio_unitario)}</span>
        <span style="float:right;font-weight:bold">S/${fmt(item.total)}</span>
      </td>
    </tr>`
  ).join('')

  const igvHtml = !f.es_exonerado
    ? `<tr><td>Op. Gravada:</td><td style="text-align:right">S/ ${fmt(f.op_gravada || f.subtotal)}</td></tr>
       <tr><td>IGV (18%):</td><td style="text-align:right">S/ ${fmt(f.igv)}</td></tr>`
    : `<tr><td>Op. Exonerada:</td><td style="text-align:right">S/ ${fmt(f.op_exonerada || f.subtotal)}</td></tr>`

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Ticket ${numeroFmt}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Courier Prime', 'Courier New', monospace;
      font-size: 11px;
      color: #000;
      background: #fff;
      width: 72mm;
      padding: 3mm;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center  { text-align: center; }
    .bold    { font-weight: bold; }
    .line    { border-top: 1px dashed #000; margin: 3px 0; }
    .double  { border-top: 2px solid #000; margin: 3px 0; }
    .empresa { font-size: 13px; font-weight: bold; text-align: center; }
    .titulo  { font-size: 12px; font-weight: bold; text-align: center; }
    .numero  { font-size: 14px; font-weight: bold; text-align: center; }
    table    { width: 100%; border-collapse: collapse; }
    td       { vertical-align: top; }
    .totales td { font-size: 11px; padding: 1px 0; }
    .total-row td { font-size: 13px; font-weight: bold; }
    .qr-section { text-align: center; margin-top: 4px; }
    .qr-section img { width: 80px; height: 80px; }
    .footer { font-size: 9px; text-align: center; margin-top: 4px; }
    .watermark {
      font-size: 20px; font-weight: bold; text-align: center;
      color: rgba(200,0,0,0.25); letter-spacing: 4px;
      transform: rotate(-15deg); margin: 6px 0;
    }
  </style>
</head>
<body>

  <!-- CABECERA EMPRESA -->
  <div class="empresa">${process.env.EMISOR_RAZON_SOCIAL || f.emisor_razon || '8MILLAS'}</div>
  <div class="center" style="font-size:10px">RUC: ${f.emisor_ruc}</div>
  <div class="center" style="font-size:9px">${process.env.EMISOR_DIRECCION || ''}</div>
  <div class="center" style="font-size:9px">${process.env.EMISOR_CIUDAD || ''}</div>

  <div class="double"></div>

  <!-- TIPO Y NÚMERO -->
  <div class="titulo">${tipoLabel}</div>
  <div class="numero">${numeroFmt}</div>

  <div class="line"></div>

  <!-- DATOS CLIENTE -->
  <table>
    <tr><td style="font-size:10px"><b>Cliente:</b> ${f.cliente_nombre}</td></tr>
    <tr><td style="font-size:10px">${f.cliente_tipo_doc || 'RUC'}: ${f.cliente_doc}</td></tr>
    <tr><td style="font-size:10px"><b>Fecha:</b> ${f.fecha_emision}</td></tr>
    ${f.fecha_vencimiento ? `<tr><td style="font-size:10px"><b>Vence:</b> ${f.fecha_vencimiento}</td></tr>` : ''}
  </table>

  <div class="line"></div>

  <!-- ÍTEMS -->
  <table>${itemsHtml}</table>

  <div class="double"></div>

  <!-- TOTALES -->
  <table class="totales">
    ${igvHtml}
    ${f.descuento > 0 ? `<tr><td>Descuento:</td><td style="text-align:right">-S/ ${fmt(f.descuento)}</td></tr>` : ''}
    <tr class="total-row">
      <td><b>TOTAL</b></td>
      <td style="text-align:right"><b>S/ ${fmt(f.total)}</b></td>
    </tr>
  </table>

  <div class="line"></div>

  <!-- WATERMARK si está anulada -->
  ${['Anulada','Rechazada'].includes(f.estado) ? `<div class="watermark">${f.estado.toUpperCase()}</div>` : ''}

  <!-- QR SUNAT -->
  ${qrDataUrl ? `
  <div class="qr-section">
    <img src="${qrDataUrl}" alt="QR SUNAT"/>
    <div style="font-size:9px;margin-top:2px">Consulte en sunat.gob.pe</div>
  </div>` : ''}

  <div class="line"></div>

  <!-- PIE -->
  <div class="footer">
    Representación impresa de comprobante electrónico<br/>
    Autorizado por SUNAT · R.S. 097-2012
  </div>

</body>
</html>`
}
