// ══════════════════════════════════════════════════════════════════
// SUNAT API DIRECTA — 100% GRATUITO
// ══════════════════════════════════════════════════════════════════

import axios from "axios";
import { SignedXml } from "xml-crypto";
import forge from "node-forge";
import { getDb } from "../lib/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { buildXmlFactura, buildXmlBoleta, buildXmlNotaCredito } from "./sunat.xml.js";

const SUNAT = {
  TOKEN_URL:      "https://api-seguridad.sunat.gob.pe/v1/clientessol",
  CPE_URL:        "https://api-cpe.sunat.gob.pe/v1/contribuyente/gem",
  TOKEN_URL_BETA: "https://gw-efact.sunat.gob.pe/v1/clientessol",
  CPE_URL_BETA:   "https://gw-efact.sunat.gob.pe/v1/contribuyente/gem",
};

const IS_BETA    = process.env.SUNAT_BETA === "true";
const TOKEN_BASE = IS_BETA ? SUNAT.TOKEN_URL_BETA : SUNAT.TOKEN_URL;
const CPE_BASE   = IS_BETA ? SUNAT.CPE_URL_BETA   : SUNAT.CPE_URL;

let tokenCache = { token: null, expira: 0 };
let _certPems  = null;  // { privateKeyPem, certPem }

// ── Leer el .p12 y extraer clave privada + certificado como PEM ───
// El código anterior pasaba el buffer crudo a xml-crypto (formato incorrecto).
// xml-crypto requiere strings PEM. Usamos node-forge para parsear el PKCS#12
// correctamente, usando SUNAT_CERT_PASS para desencriptar la clave privada.
function getCertPems() {
  if (_certPems) return _certPems;

  const b64  = process.env.SUNAT_CERT_B64;
  const pass = process.env.SUNAT_CERT_PASS || "";

  if (!b64) throw new Error("SUNAT_CERT_B64 no configurado en variables de entorno");

  // Convertir base64 → binario → objeto forge PKCS#12
  const certDer  = Buffer.from(b64, "base64").toString("binary");
  const p12Asn1  = forge.asn1.fromDer(certDer);
  const p12      = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pass);

  // Extraer clave privada (PKCS#8 encriptado o plano)
  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainBags    = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const keyBag =
    shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    plainBags[forge.pki.oids.keyBag]?.[0];

  if (!keyBag?.key) throw new Error("No se encontró la clave privada en el certificado .p12");

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

  // Extraer certificado público
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag  = certBags[forge.pki.oids.certBag]?.[0];

  if (!certBag?.cert) throw new Error("No se encontró el certificado en el .p12");

  const certPem = forge.pki.certificateToPem(certBag.cert);

  _certPems = { privateKeyPem, certPem };
  return _certPems;
}

// ── Obtener token OAuth de SUNAT ──────────────────────────────────
export const getTokenSunat = async () => {
  if (tokenCache.token && Date.now() < tokenCache.expira) return tokenCache.token;

  const clientId     = process.env.SUNAT_CLIENT_ID;
  const clientSecret = process.env.SUNAT_CLIENT_SECRET;
  const ruc          = process.env.EMISOR_RUC;
  const userSol      = process.env.SUNAT_SOL_USER;
  const passSol      = process.env.SUNAT_SOL_PASSWORD;

  if (!clientId || !clientSecret || !ruc || !userSol || !passSol) {
    throw new Error("Faltan variables de entorno SUNAT: CLIENT_ID, CLIENT_SECRET, RUC, SOL_USER o SOL_PASSWORD");
  }

  const url    = `${TOKEN_BASE}/${clientId}/openid-connect/token`;
  const params = new URLSearchParams({
    grant_type:    "password",
    scope:         "https://api.sunat.gob.pe/v1/contribuyente/contribuyentes",
    client_id:     clientId,
    client_secret: clientSecret,
    username:      `${ruc}${userSol}`,
    password:      passSol,
  });

  const { data } = await axios.post(url, params.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15_000,
  });

  tokenCache = {
    token:  data.access_token,
    expira: Date.now() + (data.expires_in - 60) * 1000,
  };
  return tokenCache.token;
};

// ── Firmar XML con el certificado .p12 ───────────────────────────
export const firmarXml = (xmlString, tipoDoc = "01") => {
  const { privateKeyPem, certPem } = getCertPems();

  // El xpath varía según el tipo de comprobante
  const rootElement =
    tipoDoc === "07" || tipoDoc === "08" ? "CreditNote" : "Invoice";

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
  });

  sig.addReference({
    xpath: `//*[local-name(.)='${rootElement}']`,
    digestAlgorithm:  "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/2001/10/xml-exc-c14n#",
    ],
  });

  sig.signingKey              = privateKeyPem;
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.signatureAlgorithm      = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.computeSignature(xmlString);
  return sig.getSignedXml();
};

// ── Enviar comprobante a SUNAT ────────────────────────────────────
export const enviarASunat = async (facturaId, factura, items) => {
  const db = getDb();
  try {
    let xml = "";
    if      (factura.tipo_doc === "01") xml = buildXmlFactura(factura, items);
    else if (factura.tipo_doc === "03") xml = buildXmlBoleta(factura, items);
    else if (factura.tipo_doc === "07") xml = buildXmlNotaCredito(factura, items);
    else throw new Error(`Tipo de documento no soportado: ${factura.tipo_doc}`);

    // Firmar pasando el tipo de doc para el xpath correcto
    const xmlFirmado = firmarXml(xml, factura.tipo_doc);

    const nombre   = `${factura.emisor_ruc}-${factura.tipo_doc}-${factura.serie}-${String(factura.numero).padStart(8, "0")}`;
    const xmlBase64 = Buffer.from(xmlFirmado, "utf8").toString("base64");

    const token = await getTokenSunat();
    const ruc   = process.env.EMISOR_RUC;

    const { data } = await axios.post(
      `${CPE_BASE}/comprobantes`,
      { archivo: { nomArchivo: `${nombre}.xml`, arcGreZip: xmlBase64, hashZip: "" } },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          "Content-Type": "application/json",
          ruc,
        },
        timeout: 30_000,
      }
    );

    const aceptado = data.numRspsta === "0";
    const mensaje  = data.desRspsta || "Procesado";
    const cdrUrl   = `https://e-consulta.sunat.gob.pe/ol-ti-itconsultaunificadalibre/consultaComprobantePago/consultarComprobante?ruc=${ruc}&tipoComprobante=${factura.tipo_doc}&serie=${factura.serie}&numero=${factura.numero}`;

    await db.collection("eventos_sunat").add({
      factura_id: facturaId,
      accion:     "ENVIO",
      response:   data,
      exitoso:    aceptado,
      mensaje,
      createdAt:  FieldValue.serverTimestamp(),
    });

    if (aceptado) {
      await db.collection("facturas").doc(facturaId).update({
        estado:        "Emitida",
        sunat_estado:  "Aceptado",
        sunat_codigo:  data.numRspsta,
        sunat_mensaje: mensaje,
        hash:          data.arcCdr || "",
        cdr_url:       cdrUrl,
        updatedAt:     FieldValue.serverTimestamp(),
      });
      return { ok: true, mensaje: "Comprobante aceptado por SUNAT", cdrUrl, data };
    } else {
      await db.collection("facturas").doc(facturaId).update({
        estado:        "Rechazada",
        sunat_mensaje: mensaje,
        updatedAt:     FieldValue.serverTimestamp(),
      });
      throw new Error(`SUNAT rechazó el comprobante: ${mensaje}`);
    }
  } catch (err) {
    const msg = err.response?.data?.desRspsta || err.message || "Error al enviar a SUNAT";
    await db.collection("eventos_sunat").add({
      factura_id: facturaId,
      accion:     "ERROR",
      response:   err.response?.data || {},
      exitoso:    false,
      mensaje:    msg,
      createdAt:  FieldValue.serverTimestamp(),
    }).catch(() => {});
    throw new Error(msg);
  }
};
