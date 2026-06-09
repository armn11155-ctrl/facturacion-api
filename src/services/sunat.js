// ══════════════════════════════════════════════════════════════════
// SUNAT API DIRECTA — 100% GRATUITO
// ══════════════════════════════════════════════════════════════════

import crypto from "crypto";
import axios from "axios";
import JSZip from "jszip";
import { SignedXml } from "xml-crypto";
import forge from "node-forge";
import { getDb } from "../lib/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { buildXmlFactura, buildXmlBoleta, buildXmlNotaCredito, buildXmlRA, buildXmlRC } from "./sunat.xml.js";

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
let _certPems  = null;

// ── Leer el .p12 y extraer clave privada + certificado como PEM ───
function getCertPems() {
  if (_certPems) return _certPems;

  const b64  = process.env.SUNAT_CERT_B64;
  const pass = process.env.SUNAT_CERT_PASS || "";

  if (!b64) throw new Error("SUNAT_CERT_B64 no configurado en variables de entorno");

  const certDer  = Buffer.from(b64, "base64").toString("binary");
  const p12Asn1  = forge.asn1.fromDer(certDer);
  const p12      = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pass);

  const shroudedBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const plainBags    = p12.getBags({ bagType: forge.pki.oids.keyBag });
  const keyBag =
    shroudedBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ||
    plainBags[forge.pki.oids.keyBag]?.[0];

  if (!keyBag?.key) throw new Error("No se encontró la clave privada en el certificado .p12");

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key);

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
// Soporta: Invoice/Boleta, CreditNote, VoidedDocuments (RA), SummaryDocuments (RC)
export const firmarXml = (xmlString, tipoDoc = "01") => {
  const { privateKeyPem, certPem } = getCertPems();

  let rootElement;
  if (tipoDoc === "RA")        rootElement = "VoidedDocuments";
  else if (tipoDoc === "RC")   rootElement = "SummaryDocuments";
  else if (tipoDoc === "07" || tipoDoc === "08") rootElement = "CreditNote";
  else                         rootElement = "Invoice";

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

  sig.signingKey                = privateKeyPem;
  sig.canonicalizationAlgorithm = "http://www.w3.org/2001/10/xml-exc-c14n#";
  sig.signatureAlgorithm        = "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256";
  sig.computeSignature(xmlString);

  let signedXml = sig.getSignedXml();

  const sigMatch = signedXml.match(/<Signature[\s\S]*?<\/Signature>/);
  if (sigMatch) {
    signedXml = signedXml.replace(sigMatch[0], "");
    signedXml = signedXml.replace(
      "<ext:ExtensionContent/>",
      `<ext:ExtensionContent>${sigMatch[0]}</ext:ExtensionContent>`
    );
  }

  return signedXml;
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

    const xmlFirmado = firmarXml(xml, factura.tipo_doc);

    const nombre = `${factura.emisor_ruc}-${factura.tipo_doc}-${factura.serie}-${String(factura.numero).padStart(8, "0")}`;

    const zip = new JSZip();
    zip.file(`${nombre}.xml`, xmlFirmado);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const arcGreZip = zipBuffer.toString("base64");
    const hashZip   = crypto.createHash("sha256").update(zipBuffer).digest("hex");

    const token = await getTokenSunat();
    const ruc   = process.env.EMISOR_RUC;

    const { data } = await axios.post(
      `${CPE_BASE}/comprobantes`,
      { archivo: { nomArchivo: `${nombre}.zip`, arcGreZip, hashZip } },
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

// ══════════════════════════════════════════════════════════════════
// COMUNICACIÓN DE BAJA (RA) — Enviar VoidedDocuments a SUNAT
// Solo aplica para comprobantes ya enviados a SUNAT (Emitida/Aceptada).
// Las Boletas de Venta (03) emitidas en modo RC no van por RA — van por
// el siguiente RC con instruccionID=03 (anulación en resumen diario).
// ══════════════════════════════════════════════════════════════════
export const enviarComunicacionBaja = async (facturaId, factura, motivo) => {
  const db = getDb();
  try {
    const ruc   = process.env.EMISOR_RUC;
    const razon = process.env.EMISOR_RAZON_SOCIAL;
    const hoy   = new Date().toISOString().split("T")[0];

    // Obtener correlativo RA del día (guardado en Firestore)
    const diaStr = hoy.replace(/-/g, "");
    const raRef  = db.collection("sunat_correlativos").doc(`RA-${diaStr}`);
    const raDoc  = await raRef.get();
    const correlativo = raDoc.exists ? (raDoc.data().correlativo + 1) : 1;
    await raRef.set({ correlativo, updatedAt: FieldValue.serverTimestamp() });

    const xml = buildXmlRA({
      ruc, razon,
      fechaRef:     factura.fecha_emision,
      fechaEmision: hoy,
      correlativo,
      lineas: [{
        tipo_doc: factura.tipo_doc,
        serie:    factura.serie,
        numero:   factura.numero,
        motivo:   motivo || "Anulación de la operación",
      }],
    });

    const xmlFirmado = firmarXml(xml, "RA");
    const raId       = `RA-${diaStr}-${String(correlativo).padStart(3, "0")}`;
    const nombre     = `${ruc}-${raId}`;

    const zip = new JSZip();
    zip.file(`${nombre}.xml`, xmlFirmado);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const arcGreZip = zipBuffer.toString("base64");
    const hashZip   = crypto.createHash("sha256").update(zipBuffer).digest("hex");

    const token = await getTokenSunat();

    const { data } = await axios.post(
      `${CPE_BASE}/comprobantes`,
      { archivo: { nomArchivo: `${nombre}.zip`, arcGreZip, hashZip } },
      {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ruc },
        timeout: 30_000,
      }
    );

    const aceptado = data.numRspsta === "0";
    const mensaje  = data.desRspsta || "Procesado";

    await db.collection("eventos_sunat").add({
      factura_id: facturaId,
      accion:     "BAJA_RA",
      ra_id:      raId,
      response:   data,
      exitoso:    aceptado,
      mensaje,
      createdAt:  FieldValue.serverTimestamp(),
    });

    if (aceptado) {
      await db.collection("facturas").doc(facturaId).update({
        estado:         "Anulada",
        ra_id:          raId,
        ra_estado:      "Aceptado",
        ra_mensaje:     mensaje,
        sunat_mensaje:  motivo || "Anulación de la operación",
        updatedAt:      FieldValue.serverTimestamp(),
      });
      return { ok: true, mensaje: "Comunicación de Baja aceptada por SUNAT", raId };
    } else {
      // RA rechazado — marcar con error pero no revertir estado
      await db.collection("facturas").doc(facturaId).update({
        ra_id:      raId,
        ra_estado:  "Rechazado",
        ra_mensaje: mensaje,
        updatedAt:  FieldValue.serverTimestamp(),
      });
      throw new Error(`SUNAT rechazó la Comunicación de Baja: ${mensaje}`);
    }
  } catch (err) {
    const msg = err.response?.data?.desRspsta || err.message || "Error al enviar RA a SUNAT";
    await db.collection("eventos_sunat").add({
      factura_id: facturaId,
      accion:     "ERROR_RA",
      response:   err.response?.data || {},
      exitoso:    false,
      mensaje:    msg,
      createdAt:  FieldValue.serverTimestamp(),
    }).catch(() => {});
    throw new Error(msg);
  }
};

// ══════════════════════════════════════════════════════════════════
// RESUMEN DIARIO DE BOLETAS (RC) — Enviar SummaryDocuments a SUNAT
// Agrupa todas las boletas de una fecha dada (por defecto: ayer).
// SUNAT exige el envío antes de las 24h del día siguiente.
// ══════════════════════════════════════════════════════════════════
export const enviarResumenDiario = async (fechaRef) => {
  const db    = getDb();
  const ruc   = process.env.EMISOR_RUC;
  const razon = process.env.EMISOR_RAZON_SOCIAL;
  const hoy   = new Date().toISOString().split("T")[0];

  // Obtener boletas del día de referencia
  const snap = await db.collection("facturas")
    .where("deleted",       "==", false)
    .where("tipo_doc",      "==", "03")
    .where("fecha_emision", "==", fechaRef)
    .get();

  if (snap.empty) {
    return { ok: true, mensaje: `Sin boletas para ${fechaRef}`, count: 0 };
  }

  // Solo las que ya fueron enviadas a SUNAT (Emitida/Aceptada/Anulada con cdr)
  const boletas = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(f => ["Emitida","Aceptada","Anulada","Pagada"].includes(f.estado));

  if (boletas.length === 0) {
    return { ok: true, mensaje: `Sin boletas procesables para ${fechaRef}`, count: 0 };
  }

  // Correlativo RC del día
  const diaStr = hoy.replace(/-/g, "");
  const rcRef  = db.collection("sunat_correlativos").doc(`RC-${diaStr}`);
  const rcDoc  = await rcRef.get();
  const correlativo = rcDoc.exists ? (rcDoc.data().correlativo + 1) : 1;
  await rcRef.set({ correlativo, updatedAt: FieldValue.serverTimestamp() });

  const xml = buildXmlRC({
    ruc, razon,
    fechaRef,
    fechaEmision: hoy,
    correlativo,
    lineas: boletas.map(b => ({
      serie:  b.serie,
      numero: b.numero,
      estado: b.estado,
      igv:    b.igv   || 0,
      total:  b.total || 0,
    })),
  });

  const xmlFirmado = firmarXml(xml, "RC");
  const rcId       = `RC-${diaStr}-${String(correlativo).padStart(3, "0")}`;
  const nombre     = `${ruc}-${rcId}`;

  const zip = new JSZip();
  zip.file(`${nombre}.xml`, xmlFirmado);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const arcGreZip = zipBuffer.toString("base64");
  const hashZip   = crypto.createHash("sha256").update(zipBuffer).digest("hex");

  const token = await getTokenSunat();

  const { data } = await axios.post(
    `${CPE_BASE}/comprobantes`,
    { archivo: { nomArchivo: `${nombre}.zip`, arcGreZip, hashZip } },
    {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ruc },
      timeout: 30_000,
    }
  );

  const aceptado = data.numRspsta === "0";
  const mensaje  = data.desRspsta || "Procesado";

  // Guardar registro del RC en Firestore
  const rcLogRef = await db.collection("resumenes_diarios").add({
    rc_id:        rcId,
    fecha_ref:    fechaRef,
    fecha_envio:  hoy,
    correlativo,
    boletas_ids:  boletas.map(b => b.id),
    count:        boletas.length,
    response:     data,
    aceptado,
    mensaje,
    createdAt:    FieldValue.serverTimestamp(),
  });

  await db.collection("eventos_sunat").add({
    accion:    "RESUMEN_RC",
    rc_id:     rcId,
    fecha_ref: fechaRef,
    response:  data,
    exitoso:   aceptado,
    mensaje,
    createdAt: FieldValue.serverTimestamp(),
  });

  if (aceptado) {
    // Marcar cada boleta como declarada en RC
    const batch = db.batch();
    boletas.forEach(b => {
      batch.update(db.collection("facturas").doc(b.id), {
        rc_id:        rcId,
        rc_declarada: true,
        updatedAt:    FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    return { ok: true, mensaje: "Resumen Diario aceptado por SUNAT", rcId, count: boletas.length };
  } else {
    throw new Error(`SUNAT rechazó el Resumen Diario: ${mensaje}`);
  }
};
