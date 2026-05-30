import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import routes from "./routes/index.js";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","x-api-key"],
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== "test") app.use(morgan("combined"));

app.use("/api", routes);

app.get("/", (_req, res) => res.json({
  ok: true, sistema: "8 Millas — Facturación Electrónica", version: "2.0.0"
}));

app.use((req, res) => res.status(404).json({ ok: false, error: `Ruta ${req.method} ${req.path} no encontrada` }));
app.use((err, _req, res, _next) => {
  console.error("Error:", err);
  res.status(500).json({ ok: false, error: "Error interno del servidor" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`🔥 Conectando a Firebase Firestore...`);
  console.log(`🌍 Entorno: ${process.env.NODE_ENV || "development"}\n`);
});
