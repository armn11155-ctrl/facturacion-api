import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import pool from './pool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const client = await pool.connect()
  try {
    console.log('🚀 Ejecutando migración...')
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
    await client.query(sql)
    console.log('✅ Base de datos lista — todas las tablas creadas')
  } catch (err) {
    console.error('❌ Error en migración:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()
