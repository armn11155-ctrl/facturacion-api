# 🧾 Sistema de Facturación Electrónica — 8 Millas

API REST para emitir comprobantes electrónicos directamente a **SUNAT** (100% gratuito).

---

## ⚙️ Requisitos previos

- Node.js 18+
- PostgreSQL 14+
- **Credenciales SOL de 8 Millas** (las que usas en sunat.gob.pe)
- **Client ID y Secret de SUNAT API** (se generan gratis, ver paso 3)
- **Certificado digital .p12** (SUNAT lo da gratis, ver paso 4)

---

## 🚀 Instalación paso a paso

### 1. Clonar e instalar dependencias

```bash
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Edita .env con tus datos reales
```

### 3. Obtener Client ID y Secret de SUNAT (GRATIS)

1. Entra a [sol.sunat.gob.pe](https://sol.sunat.gob.pe) con tu Clave SOL de 8 Millas
2. Ve a **"Empresas"** → **"Comprobantes de Pago"** → **"API de Comprobantes"**
3. Haz clic en **"Mis aplicaciones"** → **"Nueva aplicación"**
4. Ponle nombre: `Facturacion 8 Millas`
5. Copia el **Client ID** y **Client Secret** → pégalos en tu `.env`

```env
SUNAT_CLIENT_ID=tu_client_id_aqui
SUNAT_CLIENT_SECRET=tu_client_secret_aqui
SUNAT_SOL_USER=tu_usuario_sol  # Solo el usuario, SIN el RUC
SUNAT_SOL_PASSWORD=tu_clave_sol
```

### 4. Obtener Certificado Digital (GRATIS desde SUNAT)

1. En el portal SOL → **"Comprobantes de Pago"** → **"Certificado Digital"**
2. Descarga el archivo `.p12`
3. Guárdalo en `/config/certificado.p12`
4. Configura en `.env`:

```env
SUNAT_CERT_PATH=./config/certificado.p12
SUNAT_CERT_PASS=tu_contraseña_del_certificado
```

> **Para pruebas**: SUNAT tiene un entorno beta donde puedes emitir sin afectar datos reales.
> Activa con `SUNAT_BETA=true` en tu `.env`.

### 5. Crear la base de datos

```bash
# Crear la base de datos en PostgreSQL
psql -U postgres -c "CREATE DATABASE facturacion_8millas;"

# Ejecutar el schema (crea todas las tablas)
npm run db:migrate
```

### 6. Iniciar el servidor

```bash
# Desarrollo (con auto-reload)
npm run dev

# Producción
npm start
```

Verás:
```
✅ Conectado a PostgreSQL
🚀 Servidor corriendo en http://localhost:3000
📋 API disponible en http://localhost:3000/api
```

---

## 🔌 Conectar Vista360 con la API

### Generar API Key para Vista360

1. Inicia sesión en el panel web de facturación
2. O directamente con curl:

```bash
curl -X POST http://localhost:3000/api/auth/api-keys \
  -H "Authorization: Bearer TU_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nombre": "Vista360 App", "permisos": "lectura"}'
```

3. Copia la API Key generada (ej: `v360_abc123...`)
4. En Vista360, configura la variable de entorno:

```env
VITE_FACTURACION_API_URL=http://localhost:3000/api
VITE_FACTURACION_API_KEY=v360_abc123...
```

### Endpoints que usa Vista360

```
GET /api/vista360/facturas?panel_firebase_id=XYZ
GET /api/vista360/facturas?cliente_firebase_id=ABC&estado=Emitida
```

---

## 📡 Endpoints principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login usuario |
| GET  | `/api/facturas` | Listar comprobantes + KPIs |
| POST | `/api/facturas` | Crear borrador |
| POST | `/api/facturas/:id/emitir` | Enviar a SUNAT |
| POST | `/api/facturas/:id/cobrar` | Marcar como cobrada |
| GET  | `/api/clientes` | Listar clientes |
| POST | `/api/clientes` | Crear cliente |
| GET  | `/api/reportes/resumen` | KPIs y gráficos |
| GET  | `/api/vista360/facturas` | Para Vista360 (API Key) |

---

## 🏗️ Despliegue recomendado (gratis)

- **Railway** → [railway.app](https://railway.app) — incluye PostgreSQL gratis
- **Render** → [render.com](https://render.com) — plan gratis disponible
- **Fly.io** → [fly.io](https://fly.io) — 3 apps gratis

---

## 📝 Usuario inicial

| Campo | Valor |
|-------|-------|
| Email | `admin@8millas.pe` |
| Password | `Admin123!` |

**⚠️ Cambia la contraseña inmediatamente después de instalar.**

---

## 🔒 Lo que SUNAT valida

Cada comprobante que envías a SUNAT debe tener:
- ✅ XML formato UBL 2.1 correcto
- ✅ Firma digital con tu certificado .p12
- ✅ RUC del emisor válido y activo
- ✅ RUC/DNI del cliente (validado contra RENIEC/SUNAT)
- ✅ Cálculos de IGV correctos (18% o exonerado Ley Amazonía)
- ✅ Numeración correlativa sin saltos
