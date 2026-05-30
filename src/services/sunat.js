// ══════════════════════════════════════════════════════════════════
// SUNAT API DIRECTA — 100% GRATUITO
// ──────────────────────────────────────────────────────────────────
// No necesitas OSE ni PSE de pago.
// SUNAT ofrece su propia API REST gratuita para emisión electrónica.
//
// LO QUE NECESITAS (todo gratis):
// 1. Clave SOL de 8 Millas (ya la tienes en sunat.gob.pe)
// 2. Client ID + Secret → los generas en:
//    https://api-seguridad.sunat.gob.pe → "Mis aplicaciones"
// 3. Certificado digital p12 → SUNAT lo da gratis en:
//    sunat.gob.pe → SOL → "Comprobantes de Pago" → "Certificado Digital"
// ══════════════════════════════════════════════════════════════════

import axios from 'axios'
import { SignedXml } from 'xml-crypto'
import { readFileSync } from 'fs'
import { query } from '../db/pool.js'
import { buildXmlFactura, buildXmlBoleta, buildXmlNotaCredito } from './sunat.xml.js'

// ── Endpoints SUNAT ───────────────────────────────────────────────
const SUNAT = {
  // Producción
  TOKEN_URL: 'https://api-seguridad.sunat.gob.pe/v1/clientessol',
  CPE_URL:   'https://api-cpe.sunat.gob.pe/v1/contribuyente/gem',
  // Beta / pruebas (fix: URLs corregidas sin espacio)
  TOKEN_URL_BETA: 'https://gw-efact.sunat.gob.pe/v1/clientessol',
  CPE_URL_BETA:   'https://gw-efact.sunat.gob.pe/v1/contribuyente/gem',
}

const IS_BETA = process.env.SUNAT_BETA === 'true'
const TOKEN_BASE = IS_BETA ? SUNAT.TOKEN_URL_BETA : SUNAT.TOKEN_URL
const CPE_BASE   = IS_BETA ? SUNAT.CPE_URL_BETA   : SUNAT.CPE_URL

// Cache del token OAuth2 (expira en 1h)
let tokenCache = { token: null, expira: 0 }

// ── Caché del certificado digital (fix: se carga una sola vez) ────
// El certificado no cambia entre requests — cargarlo en cada firma
// genera I/O innecesario y ralentiza cada emisión de comprobante.
let _certBuffer = null

function getCertBuffer() {
  if (_certBuffer) return _certBuffer
  const certPath = process.env.SUNAT_CERT_PATH
  if (!certPath) throw new Error('SUNAT_CERT_PATH no configurado')
  _certBuffer = readFileSync(certPath)
  return _certBuffer
}

// ── PASO 1: Obtener token OAuth2 de SUNAT ────────────────────────
export const getTokenSunat = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expira) {
    return tokenCache.token
  }

  const clientId     = process.env.SUNAT_CLIENT_ID
  const clientSecret = process.env.SUNAT_CLIENT_SECRET
  const ruc          = process.env.EMISOR_RUC
  const userSol      = process.env.SUNAT_SOL_USER     // usuario SOL (sin RUC)
  const passSol      = process.env.SUNAT_SOL_PASSWORD // clave SOL

  const url = `${TOKEN_BASE}/${clientId}/openid-connect/token`

  const params = new URLSearchParams({
    grant_type:    'password',
    scope:         'https://api.sunat.gob.pe/v1/contribuyente/contribuyentes',
    client_id:     clientId,
    client_secret: clientSecret,
    username:      `${ruc}${userSol}`,  // SUNAT pide RUC+usuario juntos
    password:      passSol,
  })

  const { data } = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15000,
  })

  tokenCache = {
    token:  data.access_token,
    expira: Date.now() + (data.expires_in - 60) * 1000,  // 60s de margen
  }

  return tokenCache.token
}

// ── PASO 2: Firmar XML con certificado digital ───────────────────
export const firmarXml = (xmlString) => {
  const certPass = process.env.SUNAT_CERT_PASS  // contraseña del certificado

  // Certificado cacheado a nivel de módulo (fix: se carga solo una vez)
  const certBuffer = getCertBuffer()

  const sig = new SignedXml({
    privateKey: certBuffer,
    publicCert: certBuffer,
  })

  sig.addReference({
    xpath: "//*[local-name(.)='Invoice']",
    digestAlgorithm:    'http://www.w3.org/2001/04/xmlenc#sha256',
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
  })

  sig.signingKey = certBuffer
  sig.canonicalizationAlgorithm = 'http://www.w3.org/2001/10/xml-exc-c14n#'
  sig.signatureAlgorithm = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'

  sig.computeSignature(xmlString)
  return sig.getSignedXml()
}

// ── PASO 3: Comprimir a ZIP y pasar a Base64 ─────────────────────
export const zipToBase64 = async (xmlFirmado, nombreArchivo) => {
  // Nombre del archivo: RUC-TIPODOC-SERIE-NUMERO.xml
  // ej: 20601234567-01-F001-00000001.xml

  // SUNAT acepta el XML directamente en Base64 en la API REST
  // No necesita ZIP como en el antiguo web service SOAP
  return Buffer.from(xmlFirmado, 'utf8').toString('base64')
}

// ── PASO 4: Enviar a SUNAT ────────────────────────────────────────
export const enviarASunat = async (facturaId, factura, items) => {
  let xmlSinFirmar = ''
  let xmlFirmado   = ''

  try {
    // 1. Generar XML según tipo de comprobante (UBL 2.1)
    if (factura.tipo_doc === '01') {
      xmlSinFirmar = buildXmlFactura(factura, items)
    } else if (factura.tipo_doc === '03') {
      xmlSinFirmar = buildXmlBoleta(factura, items)
    } else if (factura.tipo_doc === '07') {
      xmlSinFirmar = buildXmlNotaCredito(factura, items)
    } else {
      throw new Error(`Tipo de documento no soportado: ${factura.tipo_doc}`)
    }

    // 2. Firmar XML
    xmlFirmado = firmarXml(xmlSinFirmar)

    // 3. Pasar a Base64
    const nombreArchivo = `${factura.emisor_ruc}-${factura.tipo_doc}-${factura.serie}-${String(factura.numero).padStart(8,'0')}`
    const xmlBase64     = await zipToBase64(xmlFirmado, nombreArchivo)

    // 4. Obtener token OAuth2 de SUNAT
    const token = await getTokenSunat()

    // 5. Enviar a la API de SUNAT
    const ruc = process.env.EMISOR_RUC
    const { data } = await axios.post(
      `${CPE_BASE}/comprobantes`,
      {
        archivo: {
          nomArchivo: `${nombreArchivo}.xml`,
          arcGreZip:  xmlBase64,
          hashZip:    '',  // SUNAT lo valida internamente en la API REST
        },
      },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          'ruc':          ruc,
        },
        timeout: 30000,
      }
    )

    const aceptado = data.numRspsta === '0'
    const mensaje  = data.desRspsta || 'Procesado'

    // 6. Guardar log
    await query(
      `INSERT INTO eventos_sunat (factura_id, accion, response_body, status_code, exitoso, mensaje)
       VALUES ($1, 'ENVIO', $2, 200, $3, $4)`,
      [facturaId, JSON.stringify(data), aceptado, mensaje]
    )

    if (aceptado) {
      // Generar URL del CDR de SUNAT
      const cdrUrl = `https://e-consulta.sunat.gob.pe/ol-ti-itconsultaunificadalibre/consultaComprobantePago/consultarComprobante?ruc=${ruc}&tipoComprobante=${factura.tipo_doc}&serie=${factura.serie}&numero=${factura.numero}`

      await query(
        `UPDATE facturas SET
          estado        = 'Emitida',
          sunat_estado  = 'Aceptado',
          sunat_codigo  = $2,
          sunat_mensaje = $3,
          hash          = $4,
          cdr_url       = $5,
          updated_at    = NOW()
         WHERE id = $1`,
        [facturaId, data.numRspsta, mensaje, data.arcCdr || '', cdrUrl]
      )

      return {
        ok:      true,
        mensaje: 'Comprobante aceptado por SUNAT',
        cdrUrl,
        data,
      }
    } else {
      await query(
        `UPDATE facturas SET estado = 'Rechazada', sunat_mensaje = $2, updated_at = NOW() WHERE id = $1`,
        [facturaId, mensaje]
      )
      throw new Error(`SUNAT rechazó el comprobante: ${mensaje}`)
    }

  } catch (err) {
    const msg = err.response?.data?.desRspsta || err.message || 'Error al enviar a SUNAT'

    await query(
      `INSERT INTO eventos_sunat (factura_id, accion, response_body, status_code, exitoso, mensaje)
       VALUES ($1, 'ERROR', $2, $3, false, $4)`,
      [
        facturaId,
        JSON.stringify(err.response?.data || {}),
        err.response?.status || 500,
        msg,
      ]
    ).catch(() => {})

    throw new Error(msg)
  }
}

// ── Consultar estado de un comprobante en SUNAT ──────────────────
export const consultarEstado = async (tipoDoc, serie, numero) => {
  const token = await getTokenSunat()
  const ruc   = process.env.EMISOR_RUC

  const { data } = await axios.get(
    `${CPE_BASE}/comprobantes/${ruc}/${tipoDoc}/${serie}/${numero}/consultar`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'ruc':         ruc,
      },
      timeout: 15000,
    }
  )
  return data
}
