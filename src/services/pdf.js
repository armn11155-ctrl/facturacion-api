// ══════════════════════════════════════════════════════════════════
// SERVICIO PDF — Render-compatible
// Stack: puppeteer-core + @sparticuz/chromium + qrcode
// ══════════════════════════════════════════════════════════════════

import chromium  from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import QRCode    from 'qrcode'
import { buildHtmlFactura } from '../templates/factura.html.js'

// ── Cadena QR exigida por SUNAT ───────────────────────────────────
// Formato: RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO_DOC_CLI|NRO_DOC_CLI
function buildCadenaQR(factura) {
  const tipoDocCliente =
    factura.cliente_tipo_doc === 'DNI' ? '1' :
    factura.cliente_tipo_doc === 'RUC' ? '6' :
    factura.cliente_tipo_doc === 'CE'  ? '4' :
    factura.cliente_tipo_doc === 'PAS' ? '7' : '6'

  const cadena = [
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

  console.log('🔲 QR cadena SUNAT:', cadena)
  return cadena
}

async function generarQRDataUrl(factura) {
  const cadena = buildCadenaQR(factura)
  // 350px para que el escáner lo lea sin problemas
  const dataUrl = await QRCode.toDataURL(cadena, {
    errorCorrectionLevel: 'M',
    width: 350,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
  return { dataUrl, cadena }
}

export async function generarPdfFactura(factura) {
  const { dataUrl: qrDataUrl, cadena: qrCadena } = await generarQRDataUrl(factura)
  const html = buildHtmlFactura(factura, qrDataUrl)

  const executablePath = await chromium.executablePath()

  const browser = await puppeteer.launch({
    args:            chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless:        chromium.headless,
  })

  const page = await browser.newPage()

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })

    const pdfBuffer = await page.pdf({
      format:          'A4',
      printBackground: true,
      margin:          { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    })

    return { pdfBuffer, qrCadena }
  } finally {
    await page.close()
    await browser.close()
  }
}
