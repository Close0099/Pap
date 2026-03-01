import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const profileForm = document.getElementById('profile-form');
const nameInput = document.getElementById('profile-name');
const emailInput = document.getElementById('profile-email');
const totalBookingsEl = document.getElementById('total-bookings');
const memberSinceEl = document.getElementById('member-since');

let currentUser = null;

// 1. Verificar Autenticação
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        loadUserProfile();
        loadUserStats();
    } else {
        window.location.href = 'index.html';
    }
});

// 2. Carregar Dados do Perfil
async function loadUserProfile() {
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (userDoc.exists()) {
            const data = userDoc.data();
            nameInput.value = data.name || '';
            emailInput.value = currentUser.email;
            
            // Data de criação (Membro desde)
            if (currentUser.metadata.creationTime) {
                const date = new Date(currentUser.metadata.creationTime);
                memberSinceEl.textContent = date.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
            }
        }
    } catch (error) {
        console.error("Erro ao carregar perfil:", error);
        Swal.fire('Erro', 'Não foi possível carregar os dados.', 'error');
    }
}

// 3. Carregar Estatísticas (Total de Reservas, Gasto, Campo Favorito, Horários)
async function loadUserStats() {
    try {
        const q = query(
            collection(db, "reservas"),
            where("userId", "==", currentUser.uid)
        );
        
        const snapshot = await getDocs(q);
        const count = snapshot.size;
        totalBookingsEl.textContent = count;

        if (count === 0) return;

        // Calcular: gasto total, campo mais frequente, horários preferidos
        let totalSpent = 0;
        const courtCount = {};
        const timeCount = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Gasto total
            totalSpent += (data.price || 0);
            
            // Campo favorito
            const court = data.courtId || 'Desconhecido';
            courtCount[court] = (courtCount[court] || 0) + 1;
            
            // Horários preferidos (extrair hora)
            if (data.datetime) {
                const hour = data.datetime.split('T')[1]?.substring(0, 5) || 'N/A';
                timeCount[hour] = (timeCount[hour] || 0) + 1;
            }
        });

        // Mostrar gasto total
        document.getElementById('total-spent').textContent = totalSpent + '€';
        
        // Campo favorito (mais frequente)
        const favCourt = Object.keys(courtCount).reduce((a, b) => courtCount[a] > courtCount[b] ? a : b, 'N/A');
        document.getElementById('favorite-court').textContent = favCourt;
        
        // Horários preferidos (top 3)
        const topTimes = Object.keys(timeCount)
            .sort((a, b) => timeCount[b] - timeCount[a])
            .slice(0, 3);
        
        const timesBadges = topTimes.length > 0 
            ? topTimes.map(t => `<span class="badge bg-padel">${t}</span>`).join('')
            : '<span class="badge bg-secondary">Sem dados</span>';
        document.getElementById('favorite-times').innerHTML = timesBadges;

    } catch (error) {
        console.error("Erro ao carregar estatísticas:", error);
    }
}

// 4. Guardar Alterações
profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const newName = nameInput.value.trim();
    if (!newName) {
        Swal.fire('Atenção', 'O nome não pode estar vazio.', 'warning');
        return;
    }

    const btn = profileForm.querySelector('button[type="submit"]');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner-border spinner-border-sm"></div> A guardar...';

    try {
        await updateDoc(doc(db, "users", currentUser.uid), {
            name: newName
        });

        Swal.fire({
            icon: 'success',
            title: 'Sucesso!',
            text: 'Perfil atualizado com sucesso.',
            timer: 1500,
            showConfirmButton: false
        });

    } catch (error) {
        console.error("Erro ao atualizar:", error);
        Swal.fire('Erro', 'Não foi possível atualizar o perfil.', 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// ============================================
// SISTEMA DE MENSAGENS - Verificar Badge
// ============================================
async function checkUnreadMessages() {
    if (!currentUser) return;

    try {
        const q = query(
            collection(db, "messages"),
            where("userId", "==", currentUser.uid),
            where("read", "==", false)
        );

        const snapshot = await getCountFromServer(q);
        const unreadCount = snapshot.data().count;

        const badgeBtn = document.getElementById('message-badge-btn');
        const badgeCount = document.getElementById('message-count-badge');

        if (unreadCount > 0) {
            badgeBtn.classList.remove('d-none');
            badgeCount.textContent = unreadCount;
        } else {
            badgeBtn.classList.add('d-none');
        }
    } catch (error) {
        console.error("Erro ao verificar mensagens:", error);
    }
}


// ============================================
// SISTEMA DE MENSAGENS - Funcionalidade
// ============================================

// Abrir modal de mensagens
window.showMessagesModal = async () => {
    const modal = new bootstrap.Modal(document.getElementById('messagesModal'));
    modal.show();
    await loadMessages();
};

async function loadMessages() {
    if (!currentUser) return;

    const container = document.getElementById('messages-container');
    container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-padel" role="status"></div></div>';

    try {
        const q = query(
            collection(db, "messages"),
            where("userId", "==", currentUser.uid)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            container.innerHTML = '<p class="text-center text-secondary py-4">📭 Nenhuma mensagem.</p>';
            return;
        }

        const messages = [];
        snapshot.forEach(doc => {
            messages.push({ id: doc.id, ...doc.data() });
        });

        // Ordenar por data
        messages.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        // Renderizar
        container.innerHTML = messages.map(msg => {
            const date = msg.createdAt ? new Date(msg.createdAt.seconds * 1000).toLocaleString('pt-PT') : 'Data desconhecida';
            const isUnread = !msg.read;

            return `
                <div class="card bg-secondary border-${isUnread ? 'info' : 'dark'} mb-3">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title text-white mb-0">
                                ${isUnread ? '<span class="badge bg-info me-2">Nova</span>' : ''}
                                ${msg.title || 'Sem título'}
                            </h6>
                            <small class="text-white-50">${date}</small>
                        </div>
                        <p class="card-text text-white-50 mb-2">${msg.content || ''}</p>
                        ${isUnread ? `
                            <button class="btn btn-sm btn-outline-success mt-2 w-100" onclick="markAsRead('${msg.id}')">
                                <i class="bi bi-check2-all"></i> Marcar como lida
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error("Erro ao carregar mensagens:", error);
        container.innerHTML = '<p class="text-center text-danger py-4">❌ Erro ao carregar mensagens.</p>';
    }
}

window.markAsRead = async (messageId) => {
    try {
        await updateDoc(doc(db, "messages", messageId), {
            read: true
        });
        loadMessages();
        checkUnreadMessages();
    } catch (error) {
        console.error("Erro ao marcar como lida:", error);
    }
};

