import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, addDoc, query, where, onSnapshot, getDocs, doc, getDoc, deleteDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
// importações de notificações removidas para reverter alterações no utilizador

// Elementos DOM
const bookingForm = document.getElementById('booking-form');
const upcomingList = document.getElementById('upcoming-list');
const historyList = document.getElementById('history-list');
const loadingDiv = document.getElementById('loading-bookings');
const userNameSpan = document.getElementById('user-name');

// Widget Meteorologia
const weatherTemp = document.getElementById('weather-temp');
const weatherDesc = document.getElementById('weather-desc');
const weatherIcon = document.getElementById('weather-icon');
const weatherTime = document.getElementById('weather-time');

let currentUser = null;
let activityChart = null;
let courtChart = null;

// 1. Verificar Autenticação
onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        fetchWeather(); // Carregar meteorologia
        // Sistema de notificações temporariamente desativado
        // Buscar nome do utilizador na base de dados
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userDoc = await getDoc(userDocRef);
            if (userDoc.exists()) {
                userNameSpan.textContent = userDoc.data().name;
            } else {
                userNameSpan.textContent = user.email.split('@')[0]; // Fallback
            }
        } catch (error) {
            console.error("Erro ao buscar nome:", error);
            userNameSpan.textContent = user.email;
        }

        loadUserBookings(user.uid);
    } else {
        window.location.href = 'index.html';
    }
});

// 2. Carregar Reservas do Utilizador (Tempo Real)
function loadUserBookings(userId) {
    const q = query(
        collection(db, "reservas"),
        where("userId", "==", userId)
    );

    onSnapshot(q, (snapshot) => {
        upcomingList.innerHTML = '';
        historyList.innerHTML = '';
        loadingDiv.style.display = 'none';

        const upcomingDocs = [];
        const historyDocs = [];
        const now = new Date();

        // Variáveis para Estatísticas
        let totalGames = 0;
        let totalSpent = 0;
        const courtCounts = {}; // { 'Campo 1': 5, ... }
        const monthlyActivity = {}; // { '2024-01': 4, ... }

        snapshot.forEach((doc) => {
            const data = doc.data();
            const dateObj = new Date(data.datetime);
            
            // Separar Passado vs Futuro
            if (dateObj < now) {
                historyDocs.push({ id: doc.id, ...data, dateObj });
            } else {
                upcomingDocs.push({ id: doc.id, ...data, dateObj });
            }

            // Calcular Estatísticas (Apenas Reservas Aprovadas ou Pendentes)
            // Incluímos 'Pendente' para que o utilizador veja dados provisórios
            if (['Aprovado', 'Pendente'].includes(data.status)) {
                totalGames++;
                
                // Tratamento robusto do preço
                let p = 0;
                if (typeof data.price === 'number') p = data.price;
                else if (typeof data.price === 'string') p = parseFloat(data.price.replace('€','')) || 0;
                
                totalSpent += p;

                // Campo Favorito
                const court = data.courtId || 'Outro';
                if (!courtCounts[court]) courtCounts[court] = 0;
                courtCounts[court]++;

                // Atividade Mensal
                const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                if (!monthlyActivity[monthKey]) monthlyActivity[monthKey] = 0;
                monthlyActivity[monthKey]++;
            }
        });

        // Ordenar: Próximas (Data mais próxima primeiro) | Histórico (Data mais recente primeiro)
        upcomingDocs.sort((a, b) => a.dateObj - b.dateObj);
        historyDocs.sort((a, b) => b.dateObj - a.dateObj);

        // Renderizar Agendadas
        if (upcomingDocs.length === 0) {
            document.getElementById('no-upcoming').classList.remove('d-none');
        } else {
            document.getElementById('no-upcoming').classList.add('d-none');
            upcomingDocs.forEach(booking => renderBooking(booking, upcomingList, true));
        }

        // Renderizar Histórico
        if (historyDocs.length === 0) {
            document.getElementById('no-history').classList.remove('d-none');
        } else {
            document.getElementById('no-history').classList.add('d-none');
            historyDocs.forEach(booking => renderBooking(booking, historyList, false));
        }

        // Atualizar UI de Estatísticas
        updateUserStatsUI(totalGames, totalSpent, courtCounts, monthlyActivity);

    }, (error) => {
        console.error("Erro ao ler reservas:", error);
        loadingDiv.textContent = "Erro ao carregar reservas.";
    });
}

function updateUserStatsUI(totalGames, totalSpent, courtCounts, monthlyActivity) {
    // 1. Atualizar Cards
    const elGames = document.getElementById('stat-games');
    const elSpent = document.getElementById('stat-spent');
    const elFavCourt = document.getElementById('stat-fav-court');

    if (elGames) elGames.textContent = totalGames;
    if (elSpent) elSpent.textContent = totalSpent + '€';
    
    // Calcular campo favorito
    let favCourt = '-';
    let maxCount = 0;
    for (const [court, count] of Object.entries(courtCounts)) {
        if (count > maxCount) {
            maxCount = count;
            favCourt = court;
        }
    }
    if (elFavCourt) elFavCourt.textContent = favCourt;

    // 2. Gráfico de Atividade Mensal (Linha)
    const ctxActivity = document.getElementById('userActivityChart');
    if (ctxActivity) {
        const sortedMonths = Object.keys(monthlyActivity).sort();
        const activityValues = sortedMonths.map(m => monthlyActivity[m]);
        const labels = sortedMonths.map(m => {
            const [year, month] = m.split('-');
            const date = new Date(year, month - 1);
            return date.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
        });

        if (activityChart) activityChart.destroy();

        activityChart = new Chart(ctxActivity, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Jogos por Mês',
                    data: activityValues,
                    borderColor: '#38bdf8', // sky-400
                    backgroundColor: 'rgba(56, 189, 248, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, color: '#94a3b8' },
                        grid: { color: '#334155' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    // 3. Gráfico de Preferência de Campos (Doughnut)
    const ctxCourt = document.getElementById('userCourtChart');
    if (ctxCourt) {
        const courts = Object.keys(courtCounts);
        const values = Object.values(courtCounts);

        if (courtChart) courtChart.destroy();

        courtChart = new Chart(ctxCourt, {
            type: 'doughnut',
            data: {
                labels: courts,
                datasets: [{
                    data: values,
                    backgroundColor: ['#38bdf8', '#4ade80', '#a855f7'],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { 
                        position: 'bottom',
                        labels: { color: '#e2e8f0', padding: 20 }
                    }
                }
            }
        });
    }
}

function renderBooking(data, container, isUpcoming) {
    const li = document.createElement('li');
    li.className = 'booking-item p-3 rounded d-flex justify-content-between align-items-center';
    
    const dateStr = data.dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr = data.dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    let badgeClass = 'bg-secondary';
    let statusText = data.status;

    // Lógica de Status e Cores
    if (data.status === 'Aprovado') {
        if (!isUpcoming) {
            statusText = 'Compareceu';
            badgeClass = 'bg-success'; // Verde sólido para concluído
        } else {
            badgeClass = 'badge-approved';
        }
    } 
    else if (data.status === 'Pendente') badgeClass = 'badge-pending';
    else if (data.status === 'Recusado') badgeClass = 'badge-rejected';
    else if (data.status === 'Cancelado') {
        badgeClass = 'bg-danger bg-opacity-25 text-danger border border-danger';
        statusText = 'Cancelado pelo Utilizador';
    }

    // Botão de Cancelar (Apenas para futuras, não recusadas e não canceladas)
    let actionBtn = '';
    const calendarBtn = `
        <button class="btn btn-outline-info btn-sm ms-3" onclick="openInCalendar('${data.dateObj.toISOString()}')" title="Ver no calendário">
            <i class="bi bi-calendar-event"></i>
        </button>
    `;
    if (isUpcoming && data.status !== 'Recusado' && data.status !== 'Cancelado') {
        actionBtn = `
            ${calendarBtn}
            <button class="btn btn-outline-danger btn-sm ms-3" onclick="cancelBooking('${data.id}')" title="Cancelar Reserva">
                <i class="bi bi-x-lg"></i>
            </button>
        `;
    } else {
        actionBtn = calendarBtn;
    }

    li.innerHTML = `
        <div class="d-flex align-items-center w-100 justify-content-between">
            <div>
                <h5 class="mb-1 text-white">${data.courtId || 'Campo Padel'}</h5>
                <div class="text-secondary small">
                    <i class="bi bi-calendar-event me-1"></i> ${dateStr} 
                    <i class="bi bi-clock ms-2 me-1"></i> ${timeStr}
                </div>
            </div>
            <div class="d-flex align-items-center">
                <span class="badge ${badgeClass} rounded-pill px-3 py-2">${statusText}</span>
                ${actionBtn}
            </div>
        </div>
    `;
    container.appendChild(li);
}

// Função Global para Cancelar
window.cancelBooking = async (bookingId) => {
    const result = await Swal.fire({
        title: 'Cancelar Reserva?',
        text: "Esta ação não pode ser revertida.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, cancelar',
        cancelButtonText: 'Voltar'
    });

    if (result.isConfirmed) {
        try {
            // Buscar dados da reserva e do utilizador antes de cancelar
            const bookingRef = doc(db, "reservas", bookingId);
            const bookingSnap = await getDoc(bookingRef);
            const bookingData = bookingSnap.data();
            
            // Buscar nome do utilizador
            let userName = currentUser.email.split('@')[0]; // Fallback
            try {
                const userDocRef = doc(db, "users", currentUser.uid);
                const userDoc = await getDoc(userDocRef);
                if (userDoc.exists() && userDoc.data().name) {
                    userName = userDoc.data().name;
                }
            } catch (error) {
                console.error("Erro ao buscar nome do utilizador:", error);
            }
            
            // Atualizar status para 'Cancelado' em vez de apagar
            await updateDoc(bookingRef, {
                status: 'Cancelado',
                cancelledAt: new Date(),
                cancelledBy: currentUser.uid
            });
            
            // Criar notificação de cancelamento para o admin
            await addDoc(collection(db, "cancellationNotifications"), {
                bookingId: bookingId,
                userId: bookingData.userId,
                userEmail: bookingData.userEmail,
                userName: userName,
                courtId: bookingData.courtId,
                datetime: bookingData.datetime,
                price: bookingData.price,
                cancelledAt: new Date(),
                status: 'pending', // pending, freed, kept-blocked
                viewed: false,
                createdAt: new Date()
            });
            
            Swal.fire('Cancelado!', 'A tua reserva foi cancelada.', 'success');
            // A lista atualiza-se sozinha graças ao onSnapshot
        } catch (error) {
            console.error("Erro ao cancelar:", error);
            Swal.fire('Erro', 'Não foi possível cancelar.', 'error');
        }
    }
};

// Abrir calendário na data/hora da reserva
window.openInCalendar = function(isoDate) {
    try {
        const url = new URL(window.location.origin + '/calendar.html');
        url.searchParams.set('focus', isoDate);
        window.location.href = url.toString();
    } catch (error) {
        console.error('Erro ao abrir calendário:', error);
    }
};

// 3. Lógica de Horários e Grelha
const datePicker = document.getElementById('booking-date-picker');
const courtSelect = document.getElementById('booking-court');
const slotsContainer = document.getElementById('time-slots-container');
const selectedTimeInput = document.getElementById('selected-time');
const confirmBtn = document.getElementById('btn-confirm');
const priceContainer = document.getElementById('price-container');
const priceDisplay = document.getElementById('price-display');

// Horários de Funcionamento
const MORNING_SLOTS = ['09:00', '10:00', '11:00'];
const AFTERNOON_SLOTS = ['14:00', '15:00', '16:00', '17:00', '18:00'];
const ALL_SLOTS = [...MORNING_SLOTS, ...AFTERNOON_SLOTS];

// Event Listeners para atualizar a grelha
if (datePicker && courtSelect) {
    // Definir data mínima como hoje (Local Time)
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;
    
    datePicker.min = todayStr;

    // Definir data máxima como 1 ano a partir de hoje
    const nextYear = new Date();
    nextYear.setFullYear(today.getFullYear() + 1);
    const nyYear = nextYear.getFullYear();
    const nyMonth = String(nextYear.getMonth() + 1).padStart(2, '0');
    const nyDay = String(nextYear.getDate()).padStart(2, '0');
    datePicker.max = `${nyYear}-${nyMonth}-${nyDay}`;

    datePicker.addEventListener('change', loadTimeSlots);
    
    // Lógica para Seleção Visual de Campos
    const courtOptions = document.querySelectorAll('.court-option');
    courtOptions.forEach(option => {
        option.addEventListener('click', () => {
            // 1. Atualizar Visual
            courtOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            // 2. Atualizar Valor do Input Escondido
            const selectedCourt = option.getAttribute('data-court');
            courtSelect.value = selectedCourt;

            // 3. Recarregar Horários
            loadTimeSlots();
        });
    });
}

async function loadTimeSlots() {
    const datePicker = document.getElementById('date-picker');
    const courtSelect = document.getElementById('court-select');
    const slotsContainer = document.getElementById('slots-container');
    const selectedTimeInput = document.getElementById('selected-time');
    const confirmBtn = document.getElementById('confirm-booking-btn');
    const priceContainer = document.getElementById('price-container');
    
    // Se os elementos não existem, não fazer nada
    if (!datePicker || !courtSelect || !slotsContainer) {
        console.log('[DEBUG] Elementos não encontrados, ignorando loadTimeSlots');
        return;
    }
    
    const dateVal = datePicker.value;
    const courtVal = courtSelect.value;
    
    console.log(`[DEBUG] loadTimeSlots chamado - dateVal: ${dateVal}, courtVal: ${courtVal}`);

    // Reset
    if (selectedTimeInput) selectedTimeInput.value = '';
    if (confirmBtn) confirmBtn.disabled = true;
    if (priceContainer) priceContainer.classList.add('d-none'); // Esconder preço ao mudar dia/campo
    slotsContainer.innerHTML = '<div class="text-center text-padel py-3" style="grid-column: span 3;"><div class="spinner-border spinner-border-sm"></div> A verificar...</div>';

    if (!dateVal) return;

    // Validar Data Passada
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`;

    if (dateVal < todayStr) {
        slotsContainer.innerHTML = '<div class="text-center text-danger py-3" style="grid-column: span 3;">Não é possível reservar no passado!</div>';
        return;
    }

    // 1. Validar Dia da Semana (Domingo = 0)
    const dateObj = new Date(dateVal);
    if (dateObj.getDay() === 0) {
        slotsContainer.innerHTML = '<div class="text-center text-danger py-3" style="grid-column: span 3;">Fechado aos Domingos!</div>';
        return;
    }

    try {
        // 2. Buscar reservas existentes para este dia e campo - COM FILTRO DE DATA
        const startOfDay = dateVal + 'T00:00:00';
        const endOfDay = dateVal + 'T23:59:59';
        
        const qReservas = query(
            collection(db, "reservas"),
            where("courtId", "==", courtVal),
            where("datetime", ">=", startOfDay),
            where("datetime", "<=", endOfDay)
        );
        
        const snapshotReservas = await getDocs(qReservas);
        
        console.log(`[DEBUG] Buscando para ${courtVal} no dia ${dateVal}`);
        console.log(`[DEBUG] Total de documentos encontrados: ${snapshotReservas.size}`);
        
        // Criar lista de horas ocupadas (apenas para o dia selecionado)
        // APENAS contam: Aprovado e Pendente
        // NÃO contam: Recusado e Cancelado
        const occupiedHours = [];
        snapshotReservas.forEach(doc => {
            const data = doc.data();
            console.log(`[DEBUG] Doc ${doc.id}: status="${data.status}", datetime="${data.datetime}"`);
            // Contar como ocupado APENAS se for Aprovado ou Pendente
            if ((data.status === 'Aprovado' || data.status === 'Pendente')) {
                const timePart = data.datetime.split('T')[1];
                occupiedHours.push(timePart);
                console.log(`[DEBUG] ✓ Marcado como ocupado: ${timePart}`);
            } else {
                console.log(`[DEBUG] ✗ Ignorado (status: ${data.status})`);
            }
        });
        
        console.log(`[DEBUG] Horários ocupados finais:`, occupiedHours);

        // 3. Buscar slots bloqueados para este dia e campo
        const qBlocked = query(
            collection(db, "blockedSlots"),
            where("date", "==", dateVal),
            where("courtId", "==", courtVal)
        );
        
        const snapshotBlocked = await getDocs(qBlocked);
        snapshotBlocked.forEach(doc => {
            const data = doc.data();
            occupiedHours.push(data.time); // Adicionar horário bloqueado
        });

        // 3. Gerar Botões
        slotsContainer.innerHTML = '';
        
        // Variáveis para verificar hora passada (Timezone local)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;
        
        const isToday = dateVal === todayStr;

        ALL_SLOTS.forEach(time => {
            const isTaken = occupiedHours.includes(time);
            
            // Verificar se o horário já passou (apenas se for hoje)
            let isPast = false;
            if (isToday) {
                const [h, m] = time.split(':').map(Number);
                const slotDate = new Date();
                slotDate.setHours(h, m, 0, 0);
                if (slotDate < now) isPast = true;
            }

            const isDisabled = isTaken || isPast;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = isDisabled 
                ? 'btn btn-outline-danger disabled' 
                : 'btn btn-outline-light';
            
            btn.textContent = time;
            
            if (isDisabled) {
                btn.style.opacity = '0.5';
                if (isTaken) {
                    btn.style.textDecoration = 'line-through';
                    btn.title = "Reservado";
                } else {
                    btn.style.backgroundColor = '#343a40'; // Cinzento escuro
                    btn.style.borderColor = '#343a40';
                    btn.title = "Horário já passou";
                }
            } else {
                btn.onclick = () => selectTime(btn, time);
            }

            slotsContainer.appendChild(btn);
        });

    } catch (error) {
        console.error("Erro ao carregar horários:", error);
        slotsContainer.innerHTML = '<div class="text-center text-danger" style="grid-column: span 3;">Erro ao carregar horários.</div>';
    }
}

function selectTime(btn, time) {
    // Remover seleção anterior
    const allBtns = slotsContainer.querySelectorAll('.btn-outline-light');
    allBtns.forEach(b => {
        b.classList.remove('active', 'bg-padel', 'text-black', 'border-0');
    });

    // Ativar novo
    btn.classList.add('active', 'bg-padel', 'text-black', 'border-0');
    
    // Guardar valor
    selectedTimeInput.value = time;
    confirmBtn.disabled = false;

    // Mostrar opção de recurso após selecionar hora
    document.getElementById('recurring-container').classList.remove('d-none');

    updatePrice(time);
}

function updatePrice(time) {
    if (!priceContainer || !priceDisplay) return;

    const court = courtSelect.value;
    let basePrice = 20; // Indoor Default
    
    // Regra 1: Outdoor é mais barato
    if (court === 'Campo 3') {
        basePrice = 15;
    }

    // Regra 2: Horário Nobre (+18h) é mais caro
    const hour = parseInt(time.split(':')[0]);
    if (hour >= 18) {
        basePrice += 5;
    }

    priceDisplay.textContent = `${basePrice}€`;
    priceContainer.classList.remove('d-none');
}

// 4. Submeter Reserva (Atualizado)
if (bookingForm) {
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!currentUser) return;

        const dateVal = datePicker.value;
        const timeVal = selectedTimeInput.value;
        const courtVal = courtSelect.value;

        if (!dateVal || !timeVal) {
            Swal.fire('Atenção', 'Seleciona um dia e um horário.', 'warning');
            return;
        }

        // Construir o datetime string final (YYYY-MM-DDTHH:mm)
        const finalDateTime = `${dateVal}T${timeVal}`;
        
        // Calcular Preço Final para guardar
        let finalPrice = 20;
        if (courtVal === 'Campo 3') finalPrice = 15;
        if (parseInt(timeVal.split(':')[0]) >= 18) finalPrice += 5;

        // CONFIRMAÇÃO ANTES DE RESERVAR
        const result = await Swal.fire({
            title: 'Confirmar Reserva',
            html: `
                <div class="text-start" style="font-size: 0.95rem;">
                    <p><strong>Campo:</strong> ${courtVal}</p>
                    <p><strong>Data:</strong> ${new Date(dateVal).toLocaleDateString('pt-PT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                    <p><strong>Hora:</strong> ${timeVal}</p>
                    <p class="mb-0"><strong>Preço:</strong> <span class="text-padel">${finalPrice}€</span></p>
                </div>
            `,
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#84cc16',
            cancelButtonColor: '#334155',
            confirmButtonText: 'Confirmar Reserva',
            cancelButtonText: 'Cancelar'
        });

        if (!result.isConfirmed) return;

        try {
            confirmBtn.textContent = "A reservar...";
            confirmBtn.disabled = true;

            // Verificação final de segurança (Double Check)
            const q = query(
                collection(db, "reservas"),
                where("courtId", "==", courtVal)
            );
            const snapshot = await getDocs(q);
            
            const isNowTaken = snapshot.docs.some(doc => {
                const data = doc.data();
                return data.status !== 'Recusado' && data.datetime === finalDateTime;
            });

            if (isNowTaken) {
                throw new Error("SLOT_NOW_TAKEN");
            }

            const isRecurring = document.getElementById('recurring-checkbox').checked;
            
            await addDoc(collection(db, "reservas"), {
                userId: currentUser.uid,
                userEmail: currentUser.email,
                datetime: finalDateTime,
                courtId: courtVal,
                price: finalPrice,
                status: "Pendente",
                recurring: isRecurring,
                timestamp: new Date()
            });

            Swal.fire({
                icon: 'success',
                title: 'Reserva Enviada!',
                html: `
                    <img src="img/handshake.gif" alt="Sucesso" style="width: 100px; height: auto; margin: 10px auto; display: block;">
                    <p>Pedido para ${dateVal} às ${timeVal} enviado com sucesso.</p>
                `,
                timer: 2500,
                showConfirmButton: false
            });
            
            // Reset UI
            selectedTimeInput.value = '';
            confirmBtn.textContent = "Confirmar Reserva";
            confirmBtn.disabled = true;
            document.getElementById('recurring-checkbox').checked = false;
            loadTimeSlots();

        } catch (error) {
            console.error("Erro ao reservar:", error);
            
            let msg = 'Não foi possível criar a reserva.';
            if (error.message === 'SLOT_NOW_TAKEN') {
                msg = 'Este horário foi reservado noutro local. Tenta outro horário.';
            }
            
            Swal.fire('Erro', msg, 'error');
            confirmBtn.textContent = "Confirmar Reserva";
            confirmBtn.disabled = false;
        }
    });
}

// --- Função Meteorologia (Open-Meteo API) ---
async function fetchWeather() {
    if (!weatherTemp || !weatherDesc) return;

    try {
        // Coordenadas do Porto
        const lat = 41.1579;
        const lon = -8.6291;
        
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;
        
        // Mapeamento simples de códigos WMO
        let desc = "Céu Limpo";
        let iconClass = "bi-sun-fill";
        
        if (code >= 1 && code <= 3) {
            desc = "Parcialmente Nublado";
            iconClass = "bi-cloud-sun-fill";
        } else if (code >= 45 && code <= 48) {
            desc = "Nevoeiro";
            iconClass = "bi-cloud-haze-fill";
        } else if (code >= 51 && code <= 67) {
            desc = "Chuva Fraca";
            iconClass = "bi-cloud-drizzle-fill";
        } else if (code >= 80 && code <= 99) {
            desc = "Chuva Forte / Trovoada";
            iconClass = "bi-cloud-lightning-rain-fill";
        } else if (code >= 71) {
            desc = "Neve";
            iconClass = "bi-snow";
        }

        // Atualizar UI
        weatherTemp.textContent = `${temp}°C`;
        weatherDesc.textContent = desc;
        
        // Atualizar sidebar também
        const sidebarTemp = document.getElementById('weather-temp-sidebar');
        const sidebarDesc = document.getElementById('weather-desc-sidebar');
        const sidebarIcon = document.getElementById('weather-icon-sidebar');
        
        if (sidebarTemp) sidebarTemp.textContent = `${temp}°C`;
        if (sidebarDesc) sidebarDesc.textContent = desc;
        if (sidebarIcon) {
            sidebarIcon.className = `bi ${iconClass}`;
        }
        
        if (weatherTime) {
            const now = new Date();
            weatherTime.textContent = now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
        }
        
        if (weatherIcon) {
            weatherIcon.className = `bi ${iconClass} fs-1 text-warning mb-2`;
            // Ajustar cor se for chuva
            if (desc.includes("Chuva") || desc.includes("Nevoeiro")) {
                weatherIcon.classList.remove('text-warning');
                weatherIcon.classList.add('text-info');
            }
        }

    } catch (error) {
        console.error("Erro ao buscar meteorologia:", error);
        weatherDesc.textContent = "Indisponível";
    }
}

// ============================================
// SISTEMA DE MENSAGENS DO ADMIN
// ============================================

// Carregar mensagens não lidas ao login
async function checkUnreadMessages() {
    if (!currentUser) return;

    try {
        const q = query(
            collection(db, "messages"),
            where("userId", "==", currentUser.uid),
            where("read", "==", false)
        );

        const snapshot = await getDocs(q);
        const unreadCount = snapshot.size;

        // Atualizar badge
        const badgeBtn = document.getElementById('message-badge-btn');
        const badgeCount = document.getElementById('message-count-badge');

        if (unreadCount > 0) {
            badgeBtn.classList.remove('d-none');
            badgeCount.textContent = unreadCount;
            
            // Auto-abrir modal se houver mensagens não lidas
            setTimeout(() => {
                showMessagesModal();
            }, 1500);
        } else {
            badgeBtn.classList.add('d-none');
        }
    } catch (error) {
        console.error("Erro ao verificar mensagens:", error);
    }
}

// Abrir modal de mensagens
window.showMessagesModal = async () => {
    const modal = new bootstrap.Modal(document.getElementById('messagesModal'));
    modal.show();

    // Carregar mensagens
    await loadMessages();
};

// Carregar todas as mensagens do utilizador
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

        // Ordenar por data (mais recentes primeiro)
        messages.sort((a, b) => b.timestamp - a.timestamp);

        // Renderizar mensagens
        container.innerHTML = messages.map(msg => {
            const date = new Date(msg.createdAt.seconds * 1000).toLocaleString('pt-PT');
            const isUnread = !msg.read;

            return `
                <div class="card bg-secondary border-${isUnread ? 'info' : 'dark'} mb-3">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <h6 class="card-title text-white mb-0">
                                ${isUnread ? '<span class="badge bg-info me-2">Nova</span>' : ''}
                                ${msg.title}
                            </h6>
                            <small class="text-muted">${date}</small>
                        </div>
                        <p class="card-text text-white-50 mb-2">${msg.content}</p>
                        <small class="text-muted">
                            <i class="bi bi-person-fill"></i> ${msg.from}
                        </small>
                        ${isUnread ? `
                            <button class="btn btn-sm btn-outline-success mt-2 w-100" onclick="markAsRead('${msg.id}')">
                                <i class="bi bi-check2-all"></i> Marcar como lida
                            </button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Marcar todas como lidas automaticamente após 3 segundos
        setTimeout(() => {
            markAllAsRead(messages.filter(m => !m.read));
        }, 3000);

    } catch (error) {
        console.error("Erro ao carregar mensagens:", error);
        container.innerHTML = '<p class="text-center text-danger py-4">❌ Erro ao carregar mensagens.</p>';
    }
}

// Marcar mensagem como lida
window.markAsRead = async (messageId) => {
    try {
        await updateDoc(doc(db, "messages", messageId), {
            read: true
        });

        // Atualizar contador do utilizador
        const userRef = doc(db, "users", currentUser.uid);
        const userDoc = await getDoc(userRef);
        const currentUnread = userDoc.data()?.unreadMessages || 0;
        if (currentUnread > 0) {
            await updateDoc(userRef, {
                unreadMessages: currentUnread - 1
            });
        }

        // Recarregar mensagens e badge
        loadMessages();
        checkUnreadMessages();
    } catch (error) {
        console.error("Erro ao marcar como lida:", error);
    }
};

// Marcar todas como lidas (automático)
async function markAllAsRead(unreadMessages) {
    if (unreadMessages.length === 0) return;

    try {
        const batch = unreadMessages.map(msg => 
            updateDoc(doc(db, "messages", msg.id), { read: true })
        );
        await Promise.all(batch);

        // Atualizar contador do utilizador
        const userRef = doc(db, "users", currentUser.uid);
        await updateDoc(userRef, {
            unreadMessages: 0
        });

        checkUnreadMessages();
    } catch (error) {
        console.error("Erro ao marcar todas como lidas:", error);
    }
}

// Verificar mensagens ao carregar a página
setTimeout(() => {
    checkUnreadMessages();
}, 2000);
