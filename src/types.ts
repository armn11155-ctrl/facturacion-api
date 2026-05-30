/**
 * types.ts — Tipos compartidos del backend de facturación.
 *
 * Mantener sincronizados con src/types/index.ts del frontend.
 * Cuando ambos sean TypeScript strict, extraer a un paquete compartido.
 */

// ── Moneda ────────────────────────────────────────────────────────
export type Moneda = "PEN" | "USD";

// ── Tipos de comprobante ──────────────────────────────────────────
export type FacturaTipo = "FACTURA" | "BOLETA" | "NOTA_CREDITO" | "NOTA_DEBITO";

// ── Estado de factura ─────────────────────────────────────────────
export type FacturaEstado =
  | "PENDIENTE"
  | "EMITIDA"
  | "ANULADA"
  | "PAGADA"
  | "VENCIDA";

// ── Emisor (datos de la empresa) ──────────────────────────────────
export interface Emisor {
  ruc: string;
  razonSocial: string;
  nombreComercial?: string;
  direccion: string;
  ubigeo?: string;
  urbanizacion?: string;
  ciudad: string;
  departamento: string;
  pais: string;
  codigoEstablecimiento?: string;
}

// ── Receptor (cliente) ────────────────────────────────────────────
export interface Receptor {
  tipoDoc: "6" | "1" | "4" | "7" | "0"; // 6=RUC, 1=DNI, 4=CARNET_EXT, 7=PASAPORTE, 0=NO_DOMICILIADO
  numDoc: string;
  razonSocial: string;
  email?: string;
  direccion?: string;
}

// ── Ítem de factura ───────────────────────────────────────────────
export interface ItemFactura {
  descripcion: string;
  cantidad: number;
  valorUnitario: number; // sin IGV
  precioUnitario: number; // con IGV
  igv: number;
  total: number;
  unidad?: string; // NIU=unidad, ZZ=servicio
  codigoProducto?: string;
}

// ── Totales ───────────────────────────────────────────────────────
export interface TotalesFactura {
  operacionGravada: number;
  igv: number;
  total: number;
  moneda: Moneda;
  tasaIgv: number; // normalmente 0.18
}

// ── Factura completa ──────────────────────────────────────────────
export interface Factura {
  id?: string;
  tipo: FacturaTipo;
  serie: string;
  numero: number | string;
  fechaEmision: string; // ISO date YYYY-MM-DD
  emisor: Emisor;
  receptor: Receptor;
  items: ItemFactura[];
  totales: TotalesFactura;
  estado: FacturaEstado;
  observaciones?: string;
  /** URL del PDF en Cloudinary */
  pdfUrl?: string;
  /** URL del XML firmado */
  xmlUrl?: string;
  /** Código de respuesta de SUNAT */
  codigoRespuestaSunat?: string;
  /** Descripción de respuesta de SUNAT */
  descripcionRespuestaSunat?: string;
  clienteId?: string;
  panelId?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// ── Request/Response de la API ────────────────────────────────────
export interface CreateFacturaRequest {
  tipo: FacturaTipo;
  receptor: Receptor;
  items: Array<Omit<ItemFactura, "igv" | "total"> & { igv?: number; total?: number }>;
  moneda?: Moneda;
  observaciones?: string;
  clienteId?: string;
  panelId?: string;
}

export interface CreateFacturaResponse {
  ok: boolean;
  factura?: Factura;
  error?: string;
  codigoSunat?: string;
}

// ── OCR ───────────────────────────────────────────────────────────
export interface OcrRequest {
  /** Imagen en base64 */
  image: string;
}

export interface OcrResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

// ── Cloudinary ────────────────────────────────────────────────────
export interface CloudinaryDeleteRequest {
  publicId: string;
}

export interface CloudinaryDeleteResponse {
  ok: boolean;
  deleted?: boolean;
  error?: string;
}
