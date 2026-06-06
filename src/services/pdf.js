// ══════════════════════════════════════════════════════════════════
// SERVICIO PDF — Genera factura electrónica con QR (SUNAT)
// Stack: puppeteer + qrcode
// ══════════════════════════════════════════════════════════════════

import puppeteer from 'puppeteer'
import QRCode    from 'qrcode'
import { buildHtmlFactura } from '../templates/factura.html.js'

// ── Construye la cadena QR exigida por SUNAT ──────────────────────
// Formato: RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO_DOC_CLI|NRO_DOC_CLI
// Ref: R.S. 097-2012/SUNAT Anexo 2
function buildCadenaQR(factura) {
  const tipoDocCliente = factura.cliente_tipo_doc === 'DNI'  ? '1'
                       : factura.cliente_tipo_doc === 'RUC'  ? '6'
                       : factura.cliente_tipo_doc === 'CE'   ? '4'
                       : factura.cliente_tipo_doc === 'PAS'  ? '7'
                       : '6' // fallback RUC

  return [
    factura.emisor_ruc,
    factura.tipo_doc,
    factura.serie,
    String(factura.numero).padStart(8, '0'),
    Number(factura.igv).toFixed(2),
    Number(factura.total).toFixed(2),
    factura.fecha_emision,
    tipoDocCliente,
    factura.cliente_doc,
  ].join('|')
}

// ── Genera el Data URL del QR (PNG base64 para incrustar en HTML) ─
async function generarQRDataUrl(factura) {
  const cadena = buildCadenaQR(factura)
  const dataUrl = await QRCode.toDataURL(cadena, {
    errorCorrectionLevel: 'M',
    width: 180,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
  return { dataUrl, cadena }
}

// ── Instancia compartida de puppeteer (singleton) ─────────────────
let _browser = null

async function getBrowser() {
  if (!_browser || !_browser.connected) {
    _browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none',
      ],
    })
    // Cerrar limpiamente al apagar el proceso
    process.on('exit', () => _browser?.close())
  }
  return _browser
}

// ── Función principal: Factura → Buffer PDF ───────────────────────
export async function generarPdfFactura(factura) {
  const { dataUrl: qrDataUrl, cadena: qrCadena } = await generarQRDataUrl(factura)
  const html = buildHtmlFactura(factura, qrDataUrl)

  const browser = await getBrowser()
  const page    = await browser.newPage()

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    })

    return { pdfBuffer, qrCadena }
  } finally {
    await page.close()
  }
}
