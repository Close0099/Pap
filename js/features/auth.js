import { auth, db } from '../core/firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Referências DOM
const loginForm = document.querySelector('#login-form form');
const registerForm = document.querySelector('#register-form form');
const resetPasswordForm = document.getElementById('reset-password-form');

// --- REGISTO ---
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('register-name').value;
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        const btn = registerForm.querySelector('button');

        try {
            btn.textContent = 'A criar conta...';
            btn.disabled = true;

            // 1. Criar utilizador na Autenticação
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const user = userCredential.user;

            // 2. Criar documento na coleção 'users'
            await setDoc(doc(db, "users", user.uid), {
                email: email,
                name: name,
                role: "player",
                isAdmin: false,
                isBlocked: false,
                bookingCount: 0,
                createdAt: new Date()
            });

            // Aguardar um pouco para garantir que o documento foi propagado
            await new Promise(resolve => setTimeout(resolve, 500));

            Swal.fire({
                icon: 'success',
                title: 'Bem-vindo!',
                text: 'Conta criada com sucesso.',
                timer: 2000,
                showConfirmButton: false
            });
            // O onAuthStateChanged vai tratar do redirecionamento

        } catch (error) {
            console.error("Erro no registo:", error);
            let msg = "Erro ao criar conta.";
            if (error.code === 'auth/email-already-in-use') msg = "Este email já está em uso.";
            if (error.code === 'auth/weak-password') msg = "A senha deve ter pelo menos 6 caracteres.";
            
            Swal.fire({
                icon: 'error',
                title: 'Erro',
                text: msg
            });
            btn.textContent = 'Criar Conta';
            btn.disabled = false;
        }
    });
}

// --- LOGIN ---
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        const btn = loginForm.querySelector('button');

        try {
            btn.textContent = 'A entrar...';
            btn.disabled = true;

            await signInWithEmailAndPassword(auth, email, password);
            // O onAuthStateChanged vai tratar do redirecionamento

        } catch (error) {
            console.error("Erro no login:", error);
            Swal.fire({
                icon: 'error',
                title: 'Falha no Login',
                text: 'Email ou senha incorretos.'
            });
            btn.textContent = 'Entrar';
            btn.disabled = false;
        }
    });
}

// --- VERIFICAR ESTADO (Sessão) ---
onAuthStateChanged(auth, async (user) => {
    console.log("Auth State Changed. User:", user);
    
    if (user) {
        const path = window.location.pathname;
        const isLoginPage = path.includes('index.html') || path === '/' || path.endsWith('/');

        if (isLoginPage) {
            try {
                // Tentar obter documento com retry (caso tenha acabado de ser criado)
                let userDoc = await getDoc(doc(db, "users", user.uid));
                let retries = 0;
                
                while (!userDoc.exists() && retries < 3) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    userDoc = await getDoc(doc(db, "users", user.uid));
                    retries++;
                }
                
                if (userDoc.exists()) {
                    const data = userDoc.data();
                    if (data.isAdmin === true || data.role === 'admin') {
                        window.location.href = 'admin-dashboard.html';
                    } else {
                        window.location.href = 'dashboard.html';
                    }
                } else {
                    window.location.href = 'dashboard.html';
                }
            } catch (error) {
                console.error("Erro ao verificar perfil:", error);
                window.location.href = 'dashboard.html';
            }
        }
    }
});

// --- RECUPERAÇÃO DE SENHA ---
if (resetPasswordForm) {
    resetPasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const email = document.getElementById('reset-email').value;
        const btn = resetPasswordForm.querySelector('button');
        const originalText = btn.textContent;

        try {
            btn.textContent = "A verificar...";
            btn.disabled = true;

            // 1. Verificar se o email existe na base de dados (Firestore)
            const usersRef = collection(db, "users");
            const q = query(usersRef, where("email", "==", email));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                throw new Error("USER_NOT_FOUND_DB");
            }

            // 2. Se existir, enviar o email
            btn.textContent = "A enviar...";
            await sendPasswordResetEmail(auth, email);

            // Fechar o modal (Bootstrap 5)
            const modalEl = document.getElementById('forgotPasswordModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();

            Swal.fire({
                icon: 'success',
                title: 'Email Enviado!',
                text: 'Verifique a sua caixa de entrada (e spam) para redefinir a palavra-passe.',
                confirmButtonColor: '#84cc16'
            });
            
            resetPasswordForm.reset();

        } catch (error) {
            console.error("Erro ao enviar email de recuperação:", error);
            let msg = "Ocorreu um erro ao enviar o email.";
            
            if (error.message === "USER_NOT_FOUND_DB" || error.code === 'auth/user-not-found') {
                msg = "Não existe conta registada com este email.";
            } else if (error.code === 'auth/invalid-email') {
                msg = "Email inválido.";
            }

            Swal.fire({
                icon: 'error',
                title: 'Erro',
                text: msg,
                confirmButtonColor: '#ef4444'
            });
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    });
}
