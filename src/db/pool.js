// Este archivo ya no usa PostgreSQL.
// Toda la persistencia está en Firebase — ver src/lib/firebase.js
export const query = async () => { throw new Error("Usa Firebase en lugar de pg") }
export const transaction = async () => { throw new Error("Usa Firebase en lugar de pg") }
export default { query }
