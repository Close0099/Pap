// Importar as funções do SDK que precisas
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// A TUA CONFIGURAÇÃO DO FIREBASE VAI AQUI
// 1. Vai à consola do Firebase (console.firebase.google.com)
// 2. Seleciona o teu projeto existente
// 3. Vai às definições do projeto (roda dentada) -> Geral
// 4. Desce até "As tuas aplicações" e seleciona a app Web (</>)
// 5. Copia o objeto "firebaseConfig" e substitui abaixo:

const firebaseConfig = {
  apiKey: "AIzaSyASa9hSUdlyZE5Yl05cgvvjXzBhQcAGL0A",
  authDomain: "pap-padel-v2.firebaseapp.com",
  projectId: "pap-padel-v2",
  storageBucket: "pap-padel-v2.firebasestorage.app",
  messagingSenderId: "150777728680",
  appId: "1:150777728680:web:6e58984c6221b46280fc9d"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Exportar para usar noutros ficheiros
export { auth, db, firebaseConfig };