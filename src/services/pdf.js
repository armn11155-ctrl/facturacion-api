// ══════════════════════════════════════════════════════════════════
// SERVICIO PDF — Render-compatible
// Stack: puppeteer-core + @sparticuz/chromium + qrcode
// ══════════════════════════════════════════════════════════════════

import chromium  from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import QRCode    from 'qrcode'
import { buildHtmlFactura } from '../templates/factura.html.js'

// ── Cadena QR exigida por SUNAT ───────────────────────────────────
// Formato oficial: RUC|TIPO|SERIE|NUMERO|IGV|TOTAL|FECHA|TIPO_DOC_CLI|NRO_DOC_CLI
// Se envuelve en la URL del portal SUNAT para que al escanear abra
// directamente la validación en el navegador.
// Importante: todos los campos deben ser strings limpios sin NaN ni undefined,
// porque eso es lo que aparece cuando se escanea — los "números raros".
function buildCadenaQR(factura) {
  const tipoDocCliente =
    factura.cliente_tipo_doc === 'DNI' ? '1' :
    factura.cliente_tipo_doc === 'CE'  ? '4' :
    factura.cliente_tipo_doc === 'PAS' ? '7' : '6'

  // Valores defensivos: si algo es undefined/null/NaN → string vacío o '0.00'
  const ruc      = String(factura.emisor_ruc    || '')
  const tipo     = String(factura.tipo_doc      || '01')
  const serie    = String(factura.serie         || '')
  const numero   = String(factura.numero        || '0').padStart(8, '0')
  const igv      = isNaN(Number(factura.igv))   ? '0.00' : Number(factura.igv).toFixed(2)
  const total    = isNaN(Number(factura.total))  ? '0.00' : Number(factura.total).toFixed(2)
  const fecha    = String(factura.fecha_emision  || '')
  const docCli   = String(factura.cliente_doc    || '')

  const datos = [ruc, tipo, serie, numero, igv, total, fecha, tipoDocCliente, docCli].join('|')

  // URL del portal de validación de SUNAT — al escanear abre el navegador
  // El fragmento (#) es procesado por el SPA de SUNAT para buscar el comprobante
  const urlQR = `https://factura.sunat.gob.pe/validarComprobante#${datos}`

  console.log('🔲 QR SUNAT:', urlQR)
  return urlQR
}

async function generarQRDataUrl(factura) {
  const cadena = buildCadenaQR(factura)
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
