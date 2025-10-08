const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (!db) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
    db = admin.database();
  }
  return db;
}

function getDatabase() {
  return db;
}

module.exports = {
  initFirebase,
  getDatabase
};
