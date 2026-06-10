import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth as _getAuth } from "firebase-admin/auth";

let _db = null;

function ensureApp() {
  if (!getApps().length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT no configurado");
    initializeApp({ credential: cert(JSON.parse(sa)) });
  }
}

export function getDb() {
  if (_db) return _db;
  ensureApp();
  _db = getFirestore();
  return _db;
}

export function getAuth() {
  ensureApp();
  return _getAuth();
}
