import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc, updateDoc, setDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const usersList = document.getElementById('users-list');
const createUserForm = document.getElementById('create-user-form');
const PROTECTED_ADMIN_EMAIL = (window.APP_PROTECTED_ADMIN_EMAIL || '').trim().toLowerCase();

function isProtectedAccount(email = '') {
    return !!PROTECTED_ADMIN_EMAIL && String(email).toLowerCase() === PROTECTED_ADMIN_EMAIL;
}

// Flag para bloquear redirecionamentos durante criação
let isCreatingUser = false;

// 1. Verificar se é Admin
onAuthStateChanged(auth, async (user) => {
    // BLOQUEAR redirecionamentos durante criação de utilizador
    if (isCreatingUser) return;
    
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            
            if (userDoc.exists()) {
                const userData = userDoc.data();
                
                if (userData.isAdmin === true || userData.role === 'admin') {
                    loadUsers();
                } else {
                    window.location.href = 'dashboard.html';
                }
            } else {
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error("❌ Erro ao verificar permissões:", error);
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

// 2. Carregar lista de utilizadores com SINCRONIZAÇÃO EM TEMPO REAL
let allUsers = [];
let unsubscribeUsers = null;
let unsubscribeReservas = null;
let pollingInterval = null;

function loadUsers() {
    // Limpar listeners e polling anteriores
    if (unsubscribeUsers) {
        unsubscribeUsers();
    }
    if (unsubscribeReservas) {
        unsubscribeReservas();
    }
    if (pollingInterval) {
        clearInterval(pollingInterval);
    }

    const qUsers = query(collection(db, "users"));
    const qReservas = query(collection(db, "reservas"));

    try {
        // Listener para mudanças nas reservas
        unsubscribeReservas = onSnapshot(qReservas, (reservasSnapshot) => {
            
            // Contar reservas por utilizador
            const reservasPorUser = {};
            reservasSnapshot.forEach(doc => {
                const reserva = doc.data();
                const userId = reserva.userId;
                reservasPorUser[userId] = (reservasPorUser[userId] || 0) + 1;
            });

            // Atualizar contagem nas linhas existentes
            allUsers.forEach(user => {
                user.totalReservas = reservasPorUser[user.id] || 0;
            });

            // Renderizar novamente
            renderUsersList(allUsers);
        }, (error) => {
            // Ignorar erros durante criação de utilizador
            if (isCreatingUser) return;
            console.error("❌ Erro no listener de reservas:", error);
        });

        // Listener para mudanças nos utilizadores
        unsubscribeUsers = onSnapshot(qUsers, (snapshot) => {
            allUsers = [];
            
            if (snapshot.empty) {
                usersList.innerHTML = '<tr><td colspan="8" class="text-center py-3 text-secondary">Nenhum utilizador encontrado.</td></tr>';
                return;
            }

            snapshot.forEach(doc => {
                const userData = doc.data();
                const userId = doc.id;
                allUsers.push({ id: userId, ...userData, totalReservas: 0 });
            });

            renderUsersList(allUsers);
        }, (error) => {
            // Ignorar erros durante criação de utilizador
            if (isCreatingUser) return;
            console.error("❌ Erro no listener de utilizadores:", error);
        });

        // FALLBACK: Polling a cada 2 segundos se o listener falhar
        let lastCount = allUsers.length;
        pollingInterval = setInterval(async () => {
            try {
                const snapshot = await getDocs(qUsers);
                
                if (snapshot.size !== lastCount) {
                    const newUsers = [];
                    snapshot.forEach(doc => {
                        newUsers.push({ id: doc.id, ...doc.data() });
                    });
                    allUsers = newUsers;
                    lastCount = snapshot.size;
                    renderUsersList(allUsers);
                }
            } catch (error) {
                if (!isCreatingUser) {
                    console.error("❌ Erro no polling:", error);
                }
            }
        }, 2000);

    } catch (error) {
        console.error('Erro ao carregar utilizadores:', error);
        usersList.innerHTML = '<tr><td colspan="8" class="text-center py-3 text-danger">Erro ao carregar utilizadores.</td></tr>';
    }
}

// Função para renderizar a lista
function renderUsersList(users) {
    if (!usersList) return;
    
    usersList.innerHTML = '';
    users.forEach(user => {
        const row = createUserRow(user);
        usersList.appendChild(row);
    });
}

// 3. Criar linha de utilizador
function createUserRow(user) {
    const tr = document.createElement('tr');
    
    const isAdmin = user.isAdmin === true || user.role === 'admin';
    const totalReservas = user.totalReservas || 0;
    const isBlocked = user.isBlocked === true;
    const messageCount = user.unreadMessages || 0;

    tr.innerHTML = `
        <td class="text-white">${user.name || '-'}</td>
        <td class="text-secondary small">${user.email}</td>
        <td>
            <span class="badge ${isAdmin ? 'bg-danger' : 'bg-secondary'}">
                ${isAdmin ? 'Admin' : 'Jogador'}
            </span>
        </td>
        <td class="text-white">${totalReservas}</td>
        <td>
            <span class="badge ${isBlocked ? 'bg-danger' : 'bg-success'}">
                ${isBlocked ? 'Bloqueado' : 'Ativo'}
            </span>
        </td>
        <td>
            <button class="btn btn-sm btn-outline-info" onclick="openMessageModal('${user.id}', '${user.name}')" title="Enviar Mensagem">
                <i class="bi bi-envelope"></i>
                ${messageCount > 0 ? `<span class="badge bg-danger ms-1">${messageCount}</span>` : ''}
            </button>
        </td>
        <td class="text-center">
            <button class="btn btn-sm btn-outline-success" onclick="viewUserDetails('${user.id}')" title="Ver Detalhes">
                <i class="bi bi-eye-fill"></i>
            </button>
        </td>
        <td class="d-flex gap-2">
            ${!isProtectedAccount(user.email) ? `
                <button class="btn btn-sm btn-outline-warning" onclick="toggleAdminStatus('${user.id}', ${isAdmin})" title="${isAdmin ? 'Remover Admin' : 'Tornar Admin'}">
                    <i class="bi bi-shield-${isAdmin ? 'slash' : 'lock'}"></i>
                </button>
            ` : ''}
            <button class="btn btn-sm btn-outline-primary" onclick="generateAppLoginCode('${user.id}')" title="Gerar Código App">
                <i class="bi bi-phone-fill"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="toggleBlockUser('${user.id}', ${isBlocked})" title="${isBlocked ? 'Desbloquear' : 'Bloquear'}">
                <i class="bi ${isBlocked ? 'bi-unlock' : 'bi-lock'}"></i>
            </button>
            ${!isProtectedAccount(user.email) ? `
                <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${user.id}')" title="Eliminar">
                    <i class="bi bi-trash"></i>
                </button>
            ` : ''}
        </td>
    `;
    
    return tr;
}

// 4. Criar novo utilizador
if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = document.getElementById('new-user-name').value;
        const email = document.getElementById('new-user-email').value;
        const password = document.getElementById('new-user-password').value;
        const role = document.getElementById('new-user-role').value;
        const btn = createUserForm.querySelector('button');

        // Guardar credenciais do admin atual
        const currentAdmin = auth.currentUser;
        const adminEmail = currentAdmin.email;

        // PEDIR PASSWORD ANTES (senão não consegue criar documento)
        const adminPassword = prompt(`⚠️ Criar utilizador requer re-autenticação.\n\nConfirma a tua password de admin (${adminEmail}):`);
        if (!adminPassword) {
            alert("❌ Operação cancelada: senha não fornecida");
            return;
        }

        // BLOQUEAR REDIRECIONAMENTOS
        isCreatingUser = true;

        try {
            btn.textContent = 'A criar...';
            btn.disabled = true;

            // 1. Criar utilizador em Auth
            const userCredential = await createUserWithEmailAndPassword(auth, email, password);
            const newUserUid = userCredential.user.uid;

            // 2. RE-AUTENTICAR ADMIN IMEDIATAMENTE
            await signInWithEmailAndPassword(auth, adminEmail, adminPassword);

            // 2.1. RECARREGAR LISTENERS
            loadUsers();

            // 3. Criar documento em Firestore
            await setDoc(doc(db, "users", newUserUid), {
                email: email,
                name: name,
                role: role,
                isAdmin: role === 'admin',
                isBlocked: false,
                bookingCount: 0,
                createdAt: new Date()
            });

            // 4. Notificação
            if (window.Notification) {
                window.Notification.success('✅ Utilizador Criado', `${name} foi adicionado com sucesso.`, 3000);
            }

            // 5. Limpar formulário
            createUserForm.reset();
            btn.textContent = 'Criar Utilizador';
            btn.disabled = false;

            // 6. Fechar modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('createUserModal'));
            modal.hide();

            // DESBLOQUEAR REDIRECIONAMENTOS
            isCreatingUser = false;

        } catch (error) {
            console.error('❌ Erro ao criar utilizador:', error.message);
            
            // DESBLOQUEAR REDIRECIONAMENTOS
            isCreatingUser = false;
            
            let msg = 'Erro ao criar utilizador.';
            if (error.code === 'auth/email-already-in-use') msg = 'Este email já está registado.';
            if (error.code === 'auth/weak-password') msg = 'Senha fraca.';
            
            if (window.Notification) {
                window.Notification.error('Erro', msg, 3000);
            }
            
            btn.textContent = 'Criar Utilizador';
            btn.disabled = false;
        }
    });
}

// 5. Funções Globais de Ações
window.toggleAdminStatus = async (userId, isCurrentAdmin) => {
    // Verificar se é a conta protegida
    const userDoc = await getDoc(doc(db, "users", userId));
    const userData = userDoc.data();
    
    if (isProtectedAccount(userData.email)) {
        if (window.Notification) {
            window.Notification.error('❌ Bloqueado', 'Esta conta está protegida e não pode ser modificada.', 3000);
        }
        return;
    }

    const result = await Swal.fire({
        title: isCurrentAdmin ? 'Remover Admin?' : 'Tornar Admin?',
        text: isCurrentAdmin 
            ? 'Este utilizador deixará de ser administrador.' 
            : 'Este utilizador terá acesso ao painel de admin.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#84cc16',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        await updateDoc(doc(db, "users", userId), {
            isAdmin: !isCurrentAdmin,
            role: isCurrentAdmin ? 'player' : 'admin'
        });

        if (window.Notification) {
            window.Notification.success('✅ Atualizado', 'Status de admin alterado com sucesso.', 3000);
        }

        loadUsers();
    } catch (error) {
        console.error('Erro:', error);
        if (window.Notification) {
            window.Notification.error('Erro', 'Não foi possível atualizar.', 3000);
        }
    }
};

window.toggleBlockUser = async (userId, isCurrentlyBlocked) => {
    const result = await Swal.fire({
        title: isCurrentlyBlocked ? 'Desbloquear Utilizador?' : 'Bloquear Utilizador?',
        text: isCurrentlyBlocked 
            ? 'Este utilizador voltará a ter acesso.' 
            : 'Este utilizador não poderá fazer reservas.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#84cc16',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Confirmar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        await updateDoc(doc(db, "users", userId), {
            isBlocked: !isCurrentlyBlocked
        });

        if (window.Notification) {
            window.Notification.success('✅ Atualizado', isCurrentlyBlocked ? 'Utilizador desbloqueado.' : 'Utilizador bloqueado.', 3000);
        }

        loadUsers();
    } catch (error) {
        console.error('Erro:', error);
        if (window.Notification) {
            window.Notification.error('Erro', 'Não foi possível bloquear/desbloquear.', 3000);
        }
    }
};

window.deleteUser = async (userId) => {
    // Verificar se é a conta protegida
    const userDoc = await getDoc(doc(db, "users", userId));
    const userData = userDoc.data();
    
    if (isProtectedAccount(userData.email)) {
        if (window.Notification) {
            window.Notification.error('❌ Bloqueado', 'Esta conta está protegida e não pode ser eliminada.', 3000);
        }
        return;
    }

    const result = await Swal.fire({
        title: 'Eliminar Utilizador?',
        text: 'Esta ação é irreversível!',
        icon: 'error',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        // Só apaga o documento do Firestore, não da Auth (por segurança)
        await deleteDoc(doc(db, "users", userId));

        if (window.Notification) {
            window.Notification.success('✅ Eliminado', 'Utilizador foi removido.', 3000);
        }

        loadUsers();
    } catch (error) {
        console.error('Erro:', error);
        if (window.Notification) {
            window.Notification.error('Erro', 'Não foi possível eliminar.', 3000);
        }
    }
};

// 6. Código de acesso da app
const appCodeModalEl = document.getElementById('appCodeModal');
const appCodeUserNameEl = document.getElementById('app-code-user-name');
const appCodeValueEl = document.getElementById('app-code-value');
const appCodeExpiryEl = document.getElementById('app-code-expiry');
const copyAppCodeBtn = document.getElementById('copy-app-code-btn');

function generateNumericCode() {
    if (window.crypto && window.crypto.getRandomValues) {
        const array = new Uint32Array(1);
        window.crypto.getRandomValues(array);
        return (array[0] % 1000000).toString().padStart(6, '0');
    }
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function generateUniqueAppLoginCode(maxAttempts = 8) {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = generateNumericCode();
        const existingQuery = query(collection(db, 'users'), where('appLoginCode', '==', candidate));
        const existingSnapshot = await getDocs(existingQuery);

        if (existingSnapshot.empty) {
            return candidate;
        }
    }

    // Fallback raro: usa o último código gerado mesmo após colisões repetidas
    return generateNumericCode();
}

window.generateAppLoginCode = async (userId) => {
    const userFromList = allUsers.find(u => u.id === userId);
    const userName = userFromList?.name || 'Utilizador';
    const userEmail = userFromList?.email || '';

    const result = await Swal.fire({
        title: 'Gerar novo código?',
        text: 'O código anterior será invalidado automaticamente.',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#22c55e',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Gerar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        const code = await generateUniqueAppLoginCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await updateDoc(doc(db, "users", userId), {
            appLoginCode: code,
            appLoginCodeCreatedAt: new Date(),
            appLoginCodeExpiresAt: expiresAt,
            appLoginCodeUsed: false
        });

        // Enviar mensagem automática com o código
        const adminUser = auth.currentUser;
        const adminDoc = await getDoc(doc(db, "users", adminUser.uid));
        const adminName = adminDoc.data()?.name || 'Admin';

        const messageRef = doc(collection(db, "messages"));
        await setDoc(messageRef, {
            userId: userId,
            title: '📱 Código de acesso à app',
            content: `O teu código de acesso é: ${code}. Expira em ${expiresAt.toLocaleString('pt-PT')}.`,
            from: adminName,
            fromEmail: adminUser.email,
            read: false,
            createdAt: new Date(),
            timestamp: Date.now()
        });

        // Atualizar contador de mensagens não lidas
        const userRef = doc(db, "users", userId);
        const userDoc = await getDoc(userRef);
        const currentUnread = userDoc.data()?.unreadMessages || 0;
        await updateDoc(userRef, {
            unreadMessages: currentUnread + 1
        });

        if (appCodeUserNameEl) appCodeUserNameEl.textContent = userName;
        if (appCodeValueEl) appCodeValueEl.textContent = code;
        if (appCodeExpiryEl) appCodeExpiryEl.textContent = `Expira em ${expiresAt.toLocaleString('pt-PT')}`;

        if (appCodeModalEl) {
            const modal = new bootstrap.Modal(appCodeModalEl);
            modal.show();
        }

        if (window.Notification) {
            window.Notification.success('✅ Código Gerado', 'O código foi criado com sucesso.', 3000);
        }

    } catch (error) {
        console.error('Erro ao gerar código da app:', error);
        if (window.Notification) {
            window.Notification.error('Erro', 'Não foi possível gerar o código.', 3000);
        }
    }
};

if (copyAppCodeBtn) {
    copyAppCodeBtn.addEventListener('click', async () => {
        const code = appCodeValueEl?.textContent || '';
        if (!code) return;
        try {
            await navigator.clipboard.writeText(code);
            if (window.Notification) {
                window.Notification.success('✅ Copiado', 'Código copiado para a área de transferência.', 2000);
            }
        } catch (error) {
            console.error('Erro ao copiar código:', error);
            if (window.Notification) {
                window.Notification.error('Erro', 'Não foi possível copiar.', 2000);
            }
        }
    });
}

// 7. Sistema de Mensagens
window.openMessageModal = (userId, userName) => {
    document.getElementById('message-recipient-name').value = userName;
    document.getElementById('message-recipient-id').value = userId;
    document.getElementById('message-title').value = '';
    document.getElementById('message-content').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('sendMessageModal'));
    modal.show();
};

// Enviar mensagem
const sendMessageForm = document.getElementById('send-message-form');
if (sendMessageForm) {
    sendMessageForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const userId = document.getElementById('message-recipient-id').value;
        const title = document.getElementById('message-title').value;
        const content = document.getElementById('message-content').value;
        const btn = sendMessageForm.querySelector('button');

        if (!userId || !title || !content) {
            if (window.Notification) {
                window.Notification.error('Erro', 'Preencha todos os campos.', 3000);
            }
            return;
        }

        try {
            btn.innerHTML = '<i class="bi bi-hourglass-split"></i> A enviar...';
            btn.disabled = true;

            // Obter dados do admin atual
            const adminUser = auth.currentUser;
            const adminDoc = await getDoc(doc(db, "users", adminUser.uid));
            const adminName = adminDoc.data()?.name || 'Admin';

            // Criar mensagem no Firestore
            const messageRef = doc(collection(db, "messages"));
            await setDoc(messageRef, {
                userId: userId,
                title: title,
                content: content,
                from: adminName,
                fromEmail: adminUser.email,
                read: false,
                createdAt: new Date(),
                timestamp: Date.now()
            });

            // Atualizar contador de mensagens não lidas no utilizador
            const userRef = doc(db, "users", userId);
            const userDoc = await getDoc(userRef);
            const currentUnread = userDoc.data()?.unreadMessages || 0;
            await updateDoc(userRef, {
                unreadMessages: currentUnread + 1
            });

            if (window.Notification) {
                window.Notification.success('✅ Mensagem Enviada', 'O utilizador verá a mensagem quando fizer login.', 3000);
            }

            // Fechar modal e limpar form
            const modal = bootstrap.Modal.getInstance(document.getElementById('sendMessageModal'));
            modal.hide();
            sendMessageForm.reset();

            btn.innerHTML = '<i class="bi bi-send-fill"></i> Enviar Mensagem';
            btn.disabled = false;

            // Recarregar lista para atualizar contador
            loadUsers();

        } catch (error) {
            console.error('Erro ao enviar mensagem:', error);
            
            if (window.Notification) {
                window.Notification.error('Erro', 'Não foi possível enviar a mensagem.', 3000);
            }

            btn.innerHTML = '<i class="bi bi-send-fill"></i> Enviar Mensagem';
            btn.disabled = false;
        }
    });
}

// 7. Ver Detalhes do Utilizador com sincronização em tempo real
let unsubscribeUserDetails = null;
let unsubscribeReservasDetails = null;

window.viewUserDetails = async (userId) => {
    console.log("Abrindo detalhes para utilizador:", userId);
    const container = document.getElementById('user-details-content');
    
    if (!container) {
        console.error("Container não encontrado!");
        return;
    }

    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-padel" role="status"></div></div>';

    try {
        // Limpar listeners anteriores
        if (unsubscribeUserDetails) unsubscribeUserDetails();
        if (unsubscribeReservasDetails) unsubscribeReservasDetails();

        // Listener para mudanças no utilizador
        unsubscribeUserDetails = onSnapshot(doc(db, "users", userId), (userDoc) => {
            if (!userDoc.exists()) {
                container.innerHTML = '<p class="text-danger text-center">Utilizador não encontrado.</p>';
                return;
            }

            const user = userDoc.data();
            console.log("Dados do utilizador atualizados:", user);
            
            // Renderizar detalhes
            renderUserDetails(user, userId);
        });

        // Listener para mudanças nas reservas do utilizador
        const reservasQuery = query(
            collection(db, "reservas"),
            where("userId", "==", userId)
        );
        unsubscribeReservasDetails = onSnapshot(reservasQuery, (reservasSnapshot) => {
            const reservas = [];
            reservasSnapshot.forEach(doc => {
                reservas.push({ id: doc.id, ...doc.data() });
            });

            // Armazenar em allUsers para renderizar
            const userIndex = allUsers.findIndex(u => u.id === userId);
            if (userIndex >= 0) {
                allUsers[userIndex].reservas = reservas;
                renderUserDetails(allUsers[userIndex], userId);
            }
        });

        // Abrir modal
        const modal = new bootstrap.Modal(document.getElementById('userDetailsModal'));
        modal.show();

    } catch (error) {
        console.error('Erro ao carregar detalhes:', error);
        container.innerHTML = '<p class="text-danger text-center">❌ Erro ao carregar detalhes do utilizador.</p>';
    }
};

// Função para renderizar os detalhes do utilizador
function renderUserDetails(user, userId) {
    const container = document.getElementById('user-details-content');
    
    // Buscar reservas armazenadas
    const userFromAll = allUsers.find(u => u.id === userId);
    const reservas = userFromAll?.reservas || [];

    // Ordenar reservas por data E hora (mais recentes primeiro)
    reservas.sort((a, b) => {
        // Combinar data e hora para comparação completa
        const dateTimeA = new Date(a.date + ' ' + (a.time || '00:00'));
        const dateTimeB = new Date(b.date + ' ' + (b.time || '00:00'));
        return dateTimeB - dateTimeA; // Decrescente (mais recente primeiro)
    });

    // Formatar data de criação
    const createdDate = user.createdAt ? new Date(user.createdAt.seconds * 1000).toLocaleDateString('pt-PT') : '-';
    const isAdmin = user.isAdmin === true || user.role === 'admin';
    const isBlocked = user.isBlocked === true;
    const unreadMessages = user.unreadMessages || 0;

    // HTML com detalhes
    let html = `
        <div class="mb-4">
            <h6 class="text-padel mb-3">📋 Informações Pessoais</h6>
            <div class="row">
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Nome</small>
                    <p class="text-white fw-bold">${user.name || '-'}</p>
                </div>
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Email</small>
                    <p class="text-white fw-bold">${user.email}</p>
                </div>
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Tipo</small>
                    <p class="text-white fw-bold">
                        <span class="badge ${isAdmin ? 'bg-danger' : 'bg-secondary'}">${isAdmin ? 'Admin' : 'Jogador'}</span>
                    </p>
                </div>
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Status</small>
                    <p class="text-white fw-bold">
                        <span class="badge ${isBlocked ? 'bg-danger' : 'bg-success'}">${isBlocked ? 'Bloqueado' : 'Ativo'}</span>
                    </p>
                </div>
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Membro Desde</small>
                    <p class="text-white fw-bold">${createdDate}</p>
                </div>
                <div class="col-md-6 mb-2">
                    <small class="text-secondary">Mensagens Não Lidas</small>
                    <p class="text-white fw-bold">
                        ${unreadMessages > 0 ? `<span class="badge bg-warning">${unreadMessages}</span>` : '<span class="text-secondary">0</span>'}
                    </p>
                </div>
            </div>
        </div>

        <hr class="bg-secondary">

        <div class="mb-4">
            <h6 class="text-padel mb-3">🏸 Reservas Recentes</h6>
            ${reservas.length > 0 ? `
                <div class="table-responsive">
                    <table class="table table-sm table-dark">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Hora</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${reservas.slice(0, 5).map(r => {
                                // Extrair data do campo datetime ou date
                                let displayDate = '-';
                                let displayTime = '-';
                                
                                if (r.datetime) {
                                    // Se tem datetime no formato "2025-12-06T10:00"
                                    const [datePart, timePart] = r.datetime.split('T');
                                    const dateObj = new Date(datePart + 'T12:00:00');
                                    displayDate = dateObj.toLocaleDateString('pt-PT');
                                    displayTime = timePart || r.time || '-';
                                } else if (r.date) {
                                    // Se tem apenas date
                                    const dateObj = new Date(r.date + 'T12:00:00');
                                    displayDate = dateObj.toLocaleDateString('pt-PT');
                                    displayTime = r.time || '-';
                                }
                                
                                const status = r.status || 'Pendente';
                                const statusColor = status === 'Aprovado' ? 'success' : status === 'Recusado' ? 'danger' : 'warning';
                                return `
                                    <tr>
                                        <td>${displayDate}</td>
                                        <td>${displayTime}</td>
                                        <td><span class="badge bg-${statusColor}">${status}</span></td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
                <small class="text-secondary">Mostrando últimas 5 reservas de ${reservas.length} total</small>
            ` : '<p class="text-secondary">Nenhuma reserva.</p>'}
        </div>

        <hr class="bg-secondary">

        <div>
            <h6 class="text-padel mb-3">⚙️ Ações Rápidas</h6>
            ${!isProtectedAccount(user.email) ? `
                <button class="btn btn-sm btn-outline-warning me-2" onclick="toggleAdminStatus('${userId}', ${isAdmin})">
                    <i class="bi bi-shield-${isAdmin ? 'slash' : 'lock'}"></i> ${isAdmin ? 'Remover Admin' : 'Tornar Admin'}
                </button>
            ` : ''}
            <button class="btn btn-sm btn-outline-danger me-2" onclick="toggleBlockUser('${userId}', ${isBlocked})">
                <i class="bi ${isBlocked ? 'bi-unlock' : 'bi-lock'}"></i> ${isBlocked ? 'Desbloquear' : 'Bloquear'}
            </button>
            <button class="btn btn-sm btn-outline-primary me-2" onclick="generateAppLoginCode('${userId}')">
                <i class="bi bi-phone-fill"></i> Gerar Código App
            </button>
            <button class="btn btn-sm btn-outline-info" onclick="openMessageModal('${userId}', '${user.name}')">
                <i class="bi bi-envelope"></i> Enviar Mensagem
            </button>
        </div>
    `;

    container.innerHTML = html;
}

// 8. Limpar listeners ao fechar modal de detalhes
const userDetailsModal = document.getElementById('userDetailsModal');
if (userDetailsModal) {
    userDetailsModal.addEventListener('hide.bs.modal', () => {
        if (unsubscribeUserDetails) {
            unsubscribeUserDetails();
            unsubscribeUserDetails = null;
        }
        if (unsubscribeReservasDetails) {
            unsubscribeReservasDetails();
            unsubscribeReservasDetails = null;
        }
    });
}

// 9. Função de Logout
window.logout = async () => {
    // Limpar todos os listeners
    if (unsubscribeUsers) unsubscribeUsers();
    if (unsubscribeReservas) unsubscribeReservas();
    if (unsubscribeUserDetails) unsubscribeUserDetails();
    if (unsubscribeReservasDetails) unsubscribeReservasDetails();
    
    try {
        await auth.signOut();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
    }
};

