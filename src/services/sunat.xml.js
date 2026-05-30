// ══════════════════════════════════════════════════════════════════
// GENERADOR XML UBL 2.1 — Formato oficial SUNAT Perú
// Cumple con Resolución de Superintendencia N°097-2012/SUNAT
// ══════════════════════════════════════════════════════════════════

const pad = (n) => String(n).padStart(8, '0')

const xmlHeader = `<?xml version="1.0" encoding="UTF-8"?>`

// ── Líneas de detalle UBL ─────────────────────────────────────────
const buildLineas = (items, exonerado) =>
  items.map((item, i) => {
    const tipoIgv    = exonerado ? 'EXO' : (item.tipo_igv || 'GRA')
    const codTributo = tipoIgv === 'GRA' ? '1000' : tipoIgv === 'EXO' ? '9997' : '9998'
    const nomTributo = tipoIgv === 'GRA' ? 'IGV' : tipoIgv === 'EXO' ? 'EXO' : 'INA'
    const pctIgv     = tipoIgv === 'GRA' ? '18.00' : '0.00'

    return `
  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${item.unidad_medida || 'ZZ'}">${Number(item.cantidad).toFixed(4)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="PEN">${Number(item.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice>
        <cbc:PriceAmount currencyID="PEN">${Number(item.precio_unitario * (tipoIgv === 'GRA' ? 1.18 : 1)).toFixed(2)}</cbc:PriceAmount>
        <cbc:PriceTypeCode>${tipoIgv === 'GRA' ? '01' : '02'}</cbc:PriceTypeCode>
      </cac:AlternativeConditionPrice>
    </cac:PricingReference>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="PEN">${Number(item.igv_item).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="PEN">${Number(item.subtotal).toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="PEN">${Number(item.igv_item).toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Codigo de tributos">${codTributo}</cbc:ID>
          <cbc:Percent>${pctIgv}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${tipoIgv === 'GRA' ? '10' : tipoIgv === 'EXO' ? '20' : '30'}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme>
            <cbc:ID>${codTributo}</cbc:ID>
            <cbc:Name>${nomTributo}</cbc:Name>
            <cbc:TaxTypeCode>VAT</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${item.descripcion}]]></cbc:Description>
      <cac:SellersItemIdentification>
        <cbc:ID>${item.codigo || String(i + 1).padStart(3, '0')}</cbc:ID>
      </cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="PEN">${Number(item.precio_unitario).toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`
  }).join('')

// ── Bloque de impuestos totales ───────────────────────────────────
const buildTaxTotal = (f) => {
  const exo = f.es_exonerado
  const gravado = Number(f.op_gravada || 0)
  const exonerado = Number(f.op_exonerada || 0)
  const inafecto = Number(f.op_inafecta || 0)
  const igv = Number(f.igv)

  const lineas = []

  if (gravado > 0) {
    lineas.push(`
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="PEN">${gravado.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="PEN">${igv.toFixed(2)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Codigo de tributos">1000</cbc:ID>
          <cbc:Percent>18.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`)
  }

  if (exonerado > 0) {
    lineas.push(`
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="PEN">${exonerado.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="PEN">0.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Codigo de tributos">9997</cbc:ID>
          <cbc:Percent>0.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>9997</cbc:ID><cbc:Name>EXO</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`)
  }

  if (inafecto > 0) {
    lineas.push(`
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="PEN">${inafecto.toFixed(2)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="PEN">0.00</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Codigo de tributos">9998</cbc:ID>
          <cbc:Percent>0.00</cbc:Percent>
          <cac:TaxScheme><cbc:ID>9998</cbc:ID><cbc:Name>INA</cbc:Name><cbc:TaxTypeCode>FRE</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>`)
  }

  return `
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="PEN">${igv.toFixed(2)}</cbc:TaxAmount>
    ${lineas.join('')}
  </cac:TaxTotal>`
}

// ── FACTURA ELECTRÓNICA (tipo 01) ─────────────────────────────────
export const buildXmlFactura = (f, items) => {
  const serie  = f.serie
  const numero = pad(f.numero)

  return `${xmlHeader}
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:cds="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
  xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">

  <ext:UBLExtensions>
    <ext:UBLExtension>
      <ext:ExtensionContent/>
    </ext:UBLExtension>
  </ext:UBLExtensions>

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ProfileID>0101</cbc:ProfileID>
  <cbc:ID>${serie}-${numero}</cbc:ID>
  <cbc:IssueDate>${f.fecha_emision}</cbc:IssueDate>
  <cbc:IssueTime>00:00:00</cbc:IssueTime>
  <cbc:DueDate>${f.fecha_vencimiento || f.fecha_emision}</cbc:DueDate>
  <cbc:InvoiceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01">01</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[SON: ${Math.floor(f.total)} CON ${String(Math.round((f.total - Math.floor(f.total)) * 100)).padStart(2,'0')}/100 SOLES]]></cbc:Note>
  <cbc:DocumentCurrencyCode listID="ISO 4217 Alpha" listAgencyName="United Nations Economic Commission for Europe" listName="Currency">PEN</cbc:DocumentCurrencyCode>

  <cac:Signature>
    <cbc:ID>IDSignature</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${f.emisor_ruc}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${f.emisor_razon}]]></cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment>
      <cac:ExternalReference><cbc:URI>#SignatureSP</cbc:URI></cac:ExternalReference>
    </cac:DigitalSignatureAttachment>
  </cac:Signature>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Registro Único de Contribuyentes" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">
          ${f.emisor_ruc}
        </cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${f.emisor_razon}]]></cbc:Name></cac:PartyName>
      <cac:PartyTaxScheme>
        <cbc:RegistrationName><![CDATA[${f.emisor_razon}]]></cbc:RegistrationName>
        <cbc:CompanyID schemeAgencyName="PE:SUNAT" schemeName="SUNAT:Identificador de Documento de Identidad" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">${f.emisor_ruc}</cbc:CompanyID>
        <cac:RegistrationAddress>
          <cbc:AddressLine><cbc:Line><![CDATA[${process.env.EMISOR_DIRECCION}]]></cbc:Line></cbc:AddressLine>
          <cbc:CityName><![CDATA[${process.env.EMISOR_CIUDAD}]]></cbc:CityName>
        </cac:RegistrationAddress>
        <cac:TaxScheme><cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeAgencyName="PE:SUNAT" schemeName="Registro Único de Contribuyentes" schemeURI="urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06">
          ${f.cliente_doc}
        </cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${f.cliente_nombre}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:AddressLine><cbc:Line><![CDATA[${f.cliente_direccion || ''}]]></cbc:Line></cbc:AddressLine>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>

  ${buildTaxTotal(f)}

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">${Number(f.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="PEN">${Number(f.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="PEN">${Number(f.total).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="PEN">${Number(f.descuento || 0).toFixed(2)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="PEN">${Number(f.total).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${buildLineas(items, f.es_exonerado)}

</Invoice>`
}

// ── BOLETA DE VENTA (tipo 03) ─────────────────────────────────────
export const buildXmlBoleta = (f, items) => {
  // La boleta usa el mismo formato Invoice de UBL 2.1
  // solo cambia el InvoiceTypeCode (03) y el tipo de doc del cliente (1=DNI)
  const xml = buildXmlFactura(f, items)
  return xml
    .replace('>01</cbc:InvoiceTypeCode>', '>03</cbc:InvoiceTypeCode>')
}

// ── NOTA DE CRÉDITO (tipo 07) ─────────────────────────────────────
export const buildXmlNotaCredito = (f, items) => {
  const serie  = f.serie
  const numero = pad(f.numero)

  return `${xmlHeader}
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">

  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>

  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${serie}-${numero}</cbc:ID>
  <cbc:IssueDate>${f.fecha_emision}</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cbc:DiscrepancyResponse>
    <cbc:ReferenceID>${f.doc_ref_serie}-${pad(f.doc_ref_numero)}</cbc:ReferenceID>
    <cbc:ResponseCode listAgencyName="PE:SUNAT">01</cbc:ResponseCode>
    <cbc:Description><![CDATA[${f.motivo_nc || 'Anulación de operación'}]]></cbc:Description>
  </cbc:DiscrepancyResponse>
  <cac:BillingReference>
    <cac:InvoiceDocumentReference>
      <cbc:ID>${f.doc_ref_serie}-${pad(f.doc_ref_numero)}</cbc:ID>
      <cbc:DocumentTypeCode>${f.doc_ref_tipo || '01'}</cbc:DocumentTypeCode>
    </cac:InvoiceDocumentReference>
  </cac:BillingReference>

  ${buildTaxTotal(f)}

  <cac:LegalMonetaryTotal>
    <cbc:PayableAmount currencyID="PEN">${Number(f.total).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

  ${buildLineas(items, f.es_exonerado).replace(/InvoiceLine/g, 'CreditNoteLine')}

</CreditNote>`
}
