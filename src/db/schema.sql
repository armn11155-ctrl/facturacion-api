-- ══════════════════════════════════════════════════════════════════
-- SCHEMA: facturacion_8millas
-- Sistema de facturación electrónica para 8 Millas S.A.C.
-- Cumple con requisitos SUNAT (Perú) — IGV, RUC, comprobantes electrónicos
-- ══════════════════════════════════════════════════════════════════

-- Extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── USUARIOS DEL SISTEMA ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre      VARCHAR(150) NOT NULL,
  email       VARCHAR(200) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  rol         VARCHAR(30) NOT NULL DEFAULT 'operador',  -- admin | operador | contador
  activo      BOOLEAN DEFAULT true,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ── CLIENTES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo_doc        VARCHAR(10) NOT NULL DEFAULT 'RUC',  -- RUC | DNI | CE
  numero_doc      VARCHAR(20) NOT NULL,
  razon_social    VARCHAR(250) NOT NULL,
  nombre_comercial VARCHAR(250),
  direccion       VARCHAR(300),
  ubigeo          VARCHAR(10),
  ciudad          VARCHAR(100),
  email           VARCHAR(200),
  telefono        VARCHAR(30),
  estado          VARCHAR(30) DEFAULT 'Activo', -- Activo | Inactivo | Prospecto
  -- Sync con Vista360 Firebase
  firebase_id     VARCHAR(100) UNIQUE,
  deleted         BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(tipo_doc, numero_doc)
);

-- ── PRODUCTOS / SERVICIOS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS productos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  codigo          VARCHAR(50),
  descripcion     VARCHAR(300) NOT NULL,
  unidad_medida   VARCHAR(10) DEFAULT 'ZZ',   -- ZZ = Servicio (código SUNAT)
  precio_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  tipo_igv        VARCHAR(10) DEFAULT 'GRA',  -- GRA=Gravado, EXO=Exonerado, INA=Inafecto
  porcentaje_igv  NUMERIC(5,2) DEFAULT 18.00,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── PANELES (sync con Vista360) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS paneles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  firebase_id VARCHAR(100) UNIQUE,
  nombre      VARCHAR(200) NOT NULL,
  tipo        VARCHAR(100),
  ciudad      VARCHAR(100),
  direccion   VARCHAR(300),
  ubigeo      VARCHAR(10),
  estado      VARCHAR(30) DEFAULT 'Disponible',
  deleted     BOOLEAN DEFAULT false,
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- ── SERIES DE COMPROBANTES ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS series (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo_doc        VARCHAR(5) NOT NULL,    -- 01=Factura, 03=Boleta, 07=Nota Crédito, 08=Nota Débito
  serie           VARCHAR(5) NOT NULL,    -- F001, B001, FC01, BD01
  correlativo     INTEGER NOT NULL DEFAULT 0,
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE(tipo_doc, serie)
);

-- ── FACTURAS / COMPROBANTES ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Numeración
  tipo_doc        VARCHAR(5) NOT NULL,         -- 01=Factura, 03=Boleta, 07=NC, 08=ND
  serie           VARCHAR(5) NOT NULL,
  numero          INTEGER NOT NULL,
  numero_fmt      VARCHAR(20) GENERATED ALWAYS AS (serie || '-' || LPAD(numero::text, 8, '0')) STORED,

  -- Fechas
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,

  -- Emisor (8 Millas)
  emisor_ruc      VARCHAR(11) NOT NULL,
  emisor_razon    VARCHAR(250) NOT NULL,

  -- Cliente
  cliente_id      UUID REFERENCES clientes(id),
  cliente_tipo_doc VARCHAR(10) NOT NULL,
  cliente_doc     VARCHAR(20) NOT NULL,
  cliente_nombre  VARCHAR(250) NOT NULL,
  cliente_email   VARCHAR(200),
  cliente_direccion VARCHAR(300),

  -- Panel vinculado (opcional)
  panel_id        UUID REFERENCES paneles(id),
  panel_nombre    VARCHAR(200),
  periodo_inicio  DATE,
  periodo_fin     DATE,
  concepto        VARCHAR(300),

  -- Moneda
  moneda          VARCHAR(3) DEFAULT 'PEN',    -- PEN | USD
  tipo_cambio     NUMERIC(8,4) DEFAULT 1.0000,

  -- Importes
  subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,  -- valor venta sin IGV
  descuento       NUMERIC(12,2) DEFAULT 0,
  igv             NUMERIC(12,2) NOT NULL DEFAULT 0,
  otros_cargos    NUMERIC(12,2) DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- IGV especial
  op_gravada      NUMERIC(12,2) DEFAULT 0,
  op_exonerada    NUMERIC(12,2) DEFAULT 0,
  op_inafecta     NUMERIC(12,2) DEFAULT 0,
  es_exonerado    BOOLEAN DEFAULT false,       -- Ley Amazonía N°27037

  -- Estado del comprobante
  estado          VARCHAR(30) DEFAULT 'Borrador',
  -- Borrador | Emitida | Aceptada | Rechazada | Anulada | Cobrada | Vencida

  -- SUNAT / Nubefact
  sunat_estado    VARCHAR(50),
  sunat_codigo    VARCHAR(10),
  sunat_mensaje   VARCHAR(500),
  hash            VARCHAR(200),
  cdr_url         VARCHAR(500),
  pdf_url         VARCHAR(500),
  xml_url         VARCHAR(500),
  nubefact_id     VARCHAR(100),

  -- Nota de crédito/débito (referencia al comprobante original)
  doc_ref_tipo    VARCHAR(5),
  doc_ref_serie   VARCHAR(5),
  doc_ref_numero  INTEGER,
  motivo_nc       VARCHAR(300),

  -- Cobro
  pagado          BOOLEAN DEFAULT false,
  fecha_pago      DATE,
  metodo_pago     VARCHAR(100),
  nro_operacion   VARCHAR(100),

  -- Sync con Vista360
  vista360_sync   BOOLEAN DEFAULT false,
  firebase_id     VARCHAR(100),

  -- Auditoría
  usuario_id      UUID REFERENCES usuarios(id),
  deleted         BOOLEAN DEFAULT false,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),

  UNIQUE(tipo_doc, serie, numero)
);

-- ── ITEMS DE FACTURA ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS factura_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id      UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  orden           INTEGER NOT NULL DEFAULT 1,
  producto_id     UUID REFERENCES productos(id),
  descripcion     VARCHAR(300) NOT NULL,
  unidad_medida   VARCHAR(10) DEFAULT 'ZZ',
  cantidad        NUMERIC(12,4) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,2) NOT NULL,
  descuento       NUMERIC(12,2) DEFAULT 0,
  tipo_igv        VARCHAR(10) DEFAULT 'GRA',  -- GRA | EXO | INA
  porcentaje_igv  NUMERIC(5,2) DEFAULT 18.00,
  igv_item        NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal        NUMERIC(12,2) NOT NULL,     -- precio * cantidad sin IGV
  total           NUMERIC(12,2) NOT NULL      -- subtotal + igv
);

-- ── PAGOS ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pagos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id      UUID NOT NULL REFERENCES facturas(id),
  monto           NUMERIC(12,2) NOT NULL,
  moneda          VARCHAR(3) DEFAULT 'PEN',
  metodo          VARCHAR(100) NOT NULL,  -- Transferencia | Efectivo | Cheque | Yape | Plin
  nro_operacion   VARCHAR(100),
  fecha_pago      DATE NOT NULL DEFAULT CURRENT_DATE,
  banco           VARCHAR(100),
  nota            TEXT,
  usuario_id      UUID REFERENCES usuarios(id),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── LOG DE EVENTOS (auditoría SUNAT) ─────────────────────────────
CREATE TABLE IF NOT EXISTS eventos_sunat (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id      UUID REFERENCES facturas(id),
  accion          VARCHAR(100) NOT NULL,  -- ENVIO | CONSULTA | ANULACION | BAJA
  request_body    JSONB,
  response_body   JSONB,
  status_code     INTEGER,
  exitoso         BOOLEAN DEFAULT false,
  mensaje         TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── API KEYS (para Vista360 y otros clientes) ─────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(100) NOT NULL,   -- ej: "Vista360 App", "Contabilidad"
  api_key         VARCHAR(100) UNIQUE NOT NULL,
  permisos        VARCHAR(50) DEFAULT 'lectura',  -- lectura | escritura | admin
  activo          BOOLEAN DEFAULT true,
  ultimo_uso      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- ── ÍNDICES para performance ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_facturas_estado    ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha     ON facturas(fecha_emision);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente   ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_panel     ON facturas(panel_id);
CREATE INDEX IF NOT EXISTS idx_facturas_num       ON facturas(tipo_doc, serie, numero);
CREATE INDEX IF NOT EXISTS idx_items_factura      ON factura_items(factura_id);
CREATE INDEX IF NOT EXISTS idx_clientes_doc       ON clientes(numero_doc);
CREATE INDEX IF NOT EXISTS idx_eventos_factura    ON eventos_sunat(factura_id);

-- ── DATOS INICIALES ───────────────────────────────────────────────

-- Series estándar
INSERT INTO series (tipo_doc, serie, correlativo) VALUES
  ('01', 'F001', 0),
  ('03', 'B001', 0),
  ('07', 'FC01', 0),
  ('08', 'FD01', 0)
ON CONFLICT (tipo_doc, serie) DO NOTHING;

-- Producto por defecto: Arrendamiento de panel
INSERT INTO productos (codigo, descripcion, unidad_medida, precio_unitario, tipo_igv) VALUES
  ('SRV001', 'Arrendamiento de Panel Publicitario', 'ZZ', 0, 'GRA')
ON CONFLICT DO NOTHING;

-- Usuario admin por defecto (password: Admin123!)
-- CAMBIAR INMEDIATAMENTE después de instalar
INSERT INTO usuarios (nombre, email, password, rol) VALUES
  ('Administrador', 'admin@8millas.pe', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2uheWG/igi.', 'admin')
ON CONFLICT (email) DO NOTHING;
