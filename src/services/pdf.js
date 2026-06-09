// ══════════════════════════════════════════════════════════════════
// SERVICIO PDF — Render-compatible
// Stack: puppeteer-core + @sparticuz/chromium + qrcode
// ══════════════════════════════════════════════════════════════════

import chromium  from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import QRCode    from 'qrcode'
import { buildHtmlFactura } from '../templates/factura.html.js'
import { buildHtmlTicket }  from '../templates/ticket.html.js'

// ── Cadena QR exigida por SUNAT ───────────────────────────────────
function buildCadenaQR(factura) {
  const tipoDocCliente =
    factura.cliente_tipo_doc === 'DNI' ? '1' :
    factura.cliente_tipo_doc === 'CE'  ? '4' :
    factura.cliente_tipo_doc === 'PAS' ? '7' : '6'

  const ruc    = String(factura.emisor_ruc    || '')
  const tipo   = String(factura.tipo_doc      || '01')
  const serie  = String(factura.serie         || '')
  const numero = String(factura.numero        || '0').padStart(8, '0')
  const igv    = isNaN(Number(factura.igv))   ? '0.00' : Number(factura.igv).toFixed(2)
  const total  = isNaN(Number(factura.total)) ? '0.00' : Number(factura.total).toFixed(2)
  const fecha  = String(factura.fecha_emision || '')
  const docCli = String(factura.cliente_doc   || '')

  const datos  = [ruc, tipo, serie, numero, igv, total, fecha, tipoDocCliente, docCli].join('|')
  const urlQR  = `https://factura.sunat.gob.pe/validarComprobante#${datos}`
  console.log('🔲 QR SUNAT:', urlQR)
  return urlQR
}

async function generarQRDataUrl(factura) {
  const cadena  = buildCadenaQR(factura)
  const dataUrl = await QRCode.toDataURL(cadena, {
    errorCorrectionLevel: 'M',
    width: 350,
    margin: 2,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  })
  return { dataUrl, cadena }
}

// ── Lanzar Puppeteer ─────────────────────────────────────────────
async function launchBrowser() {
  const executablePath = await chromium.executablePath()
  return puppeteer.launch({
    args:            chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless:        chromium.headless,
  })
}

// ── PDF A4 (formato estándar) ─────────────────────────────────────
export async function generarPdfFactura(factura) {
  const { dataUrl: qrDataUrl, cadena: qrCadena } = await generarQRDataUrl(factura)
  const html    = buildHtmlFactura(factura, qrDataUrl)
  const browser = await launchBrowser()
  const page    = await browser.newPage()

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

// ── PDF Ticket 80mm (impresora térmica) ───────────────────────────
// Genera un PDF de ancho 80mm y altura variable (auto-fit).
// Ideal para impresoras POS Epson TM-T20, Bixolon SRP-350, Star, etc.
export async function generarPdfTicket(factura) {
  // QR más pequeño para ticket
  const qrDataUrl  = await QRCode.toDataURL(buildCadenaQR(factura), {
    errorCorrectionLevel: 'M',
    width: 120,
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  })

  const html    = buildHtmlTicket(factura, qrDataUrl)
  const browser = await launchBrowser()
  const page    = await browser.newPage()

  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 })

    // Calcular altura del contenido para que no haya espacio en blanco
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight)

    const pdfBuffer = await page.pdf({
      width:           '80mm',
      height:          `${bodyHeight + 5}px`,   // +5px de margen inferior
      printBackground: true,
      margin:          { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' },
    })

    return { pdfBuffer, qrCadena: buildCadenaQR(factura) }
  } finally {
    await page.close()
    await browser.close()
  }
}
