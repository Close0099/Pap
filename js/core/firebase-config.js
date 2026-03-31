// Importar as funções do SDK que precisas
import './runtime-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// A TUA CONFIGURAÇÃO DO FIREBASE VAI AQUI
// 1. Vai à consola do Firebase (console.firebase.google.com)
// 2. Seleciona o teu projeto existente
// 3. Vai às definições do projeto (roda dentada) -> Geral
// 4. Desce até "As tuas aplicações" e seleciona a app Web (</>)
// 5. Copia o objeto "firebaseConfig" e substitui abaixo:

const runtimeConfig = window.__FIREBASE_CONFIG__ || {};

const firebaseConfig = {
  apiKey: runtimeConfig.apiKey || "",
  authDomain: runtimeConfig.authDomain || "",
  projectId: runtimeConfig.projectId || "",
  storageBucket: runtimeConfig.storageBucket || "",
  messagingSenderId: runtimeConfig.messagingSenderId || "",
  appId: runtimeConfig.appId || ""
};

const requiredConfigKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId'
];

const missingConfigKeys = requiredConfigKeys.filter((key) => !firebaseConfig[key]);

if (missingConfigKeys.length > 0) {
  throw new Error(`Firebase não configurado. Define window.__FIREBASE_CONFIG__ com: ${missingConfigKeys.join(', ')}`);
}

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Exportar para usar noutros ficheiros
export { auth, db, firebaseConfig };