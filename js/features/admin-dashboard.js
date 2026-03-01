import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, orderBy, limit, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const pendingList = document.getElementById('pending-list');
const historyList = document.getElementById('history-list');

// Calendar Elements
const calendarGrid = document.getElementById('calendar-grid');
const datePicker = document.getElementById('admin-date-picker');
const prevDayBtn = document.getElementById('prev-day');
const nextDayBtn = document.getElementById('next-day');

const COURTS = ['Campo 1', 'Campo 2', 'Campo 3'];
const HOURS = [
    '09:00', '10:00', '11:00',
    '14:00', '15:00', '16:00', '17:00', '18:00'
];

// 1. Verificar se é Admin
onAuthStateChanged(auth, async (user) => {
    if (user) {
        try {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                const userData = userDoc.data();
                if (userData.isAdmin === true || userData.role === 'admin') {
                    console.log("Admin logado:", user.email);
                    loadStatistics();
                    loadPendingBookings();
                    loadHistoryBookings();
                    loadCancellationNotifications();
                    initCalendar();
                    setupExportButtons();
                } else {
                    window.location.href = 'dashboard.html';
                }
            } else {
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error("Erro ao verificar permissões:", error);
            window.location.href = 'index.html';
        }
    } else {
        window.location.href = 'index.html';
    }
});

// --- ESTATÍSTICAS E GRÁFICOS ---
let revenueChartInstance = null;
let courtsChartInstance = null;

function loadStatistics() {
    const q = query(collection(db, "reservas"));
    
    onSnapshot(q, (snapshot) => {
        let approved = 0;
        let pending = 0;
        let rejected = 0;
        let revenue = 0;
        
        // Dados para Gráficos
        const monthlyData = {}; // { '2024-01': 500, ... }
        const bookingCountByMonth = {}; // { '2024-01': 15, ... }
        const courtData = {}; // { 'Campo 1': 20, ... }

        snapshot.forEach(doc => {
            const data = doc.data();
            
            if (data.status === 'Aprovado') {
                approved++;
                revenue += data.price || 0;

                // Processar dados para gráficos (apenas aprovados)
                if (data.datetime) {
                    const dateObj = new Date(data.datetime);
                    // Chave Mês: AAAA-MM
                    const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
                    
                    // Receita Mensal
                    if (!monthlyData[monthKey]) monthlyData[monthKey] = 0;
                    monthlyData[monthKey] += (data.price || 0);

                    // Contagem Mensal
                    if (!bookingCountByMonth[monthKey]) bookingCountByMonth[monthKey] = 0;
                    bookingCountByMonth[monthKey]++;
                }

                // Uso dos Campos
                const court = data.courtId || 'Desconhecido';
                if (!courtData[court]) courtData[court] = 0;
                courtData[court]++;

            } else if (data.status === 'Pendente') {
                pending++;
            } else if (data.status === 'Recusado') {
                rejected++;
            }
        });
        
        // Atualizar DOM Stats Cards
        const statApproved = document.getElementById('stat-approved');
        const statPending = document.getElementById('stat-pending');
        const statRejected = document.getElementById('stat-rejected');
        const statRevenue = document.getElementById('stat-revenue');
        
        if (statApproved) statApproved.textContent = approved;
        if (statPending) statPending.textContent = pending;
        if (statRejected) statRejected.textContent = rejected;
        if (statRevenue) statRevenue.textContent = revenue + '€';

        // Atualizar Gráficos
        updateCharts(monthlyData, bookingCountByMonth, courtData);
    });
}

function updateCharts(monthlyRevenue, monthlyCount, courtUsage) {
    // 1. Gráfico de Receita (Barra + Linha)
    const ctxRevenue = document.getElementById('revenueChart');
    if (ctxRevenue) {
        // Ordenar meses
        const sortedMonths = Object.keys(monthlyRevenue).sort();
        const revenueValues = sortedMonths.map(m => monthlyRevenue[m]);
        const countValues = sortedMonths.map(m => monthlyCount[m]);
        
        // Formatar labels (ex: 2024-01 -> Jan 2024)
        const labels = sortedMonths.map(m => {
            const [year, month] = m.split('-');
            const date = new Date(year, month - 1);
            return date.toLocaleDateString('pt-PT', { month: 'short', year: 'numeric' });
        });

        if (revenueChartInstance) {
            revenueChartInstance.destroy();
        }

        revenueChartInstance = new Chart(ctxRevenue, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Receita (€)',
                        data: revenueValues,
                        backgroundColor: 'rgba(56, 189, 248, 0.5)', // sky-400
                        borderColor: '#38bdf8',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Nº Reservas',
                        data: countValues,
                        type: 'line',
                        borderColor: '#a855f7', // purple-500
                        backgroundColor: '#a855f7',
                        borderWidth: 2,
                        pointRadius: 4,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { labels: { color: '#e2e8f0' } }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid: { color: '#334155' }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: 'Receita (€)', color: '#38bdf8' },
                        ticks: { color: '#94a3b8' },
                        grid: { color: '#334155' }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Reservas', color: '#a855f7' },
                        ticks: { color: '#94a3b8' },
                        grid: { drawOnChartArea: false }
                    }
                }
            }
        });
    }

    // 2. Gráfico de Campos (Doughnut)
    const ctxCourts = document.getElementById('courtsChart');
    if (ctxCourts) {
        const courts = Object.keys(courtUsage);
        const values = Object.values(courtUsage);

        if (courtsChartInstance) {
            courtsChartInstance.destroy();
        }

        courtsChartInstance = new Chart(ctxCourts, {
            type: 'doughnut',
            data: {
                labels: courts,
                datasets: [{
                    data: values,
                    backgroundColor: [
                        '#38bdf8', // sky-400
                        '#4ade80', // green-400
                        '#a855f7', // purple-500
                        '#facc15', // yellow-400
                    ],
                    borderWidth: 0
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

// --- EXPORTAÇÃO DE DADOS ---
let allHistoryData = [];

function setupExportButtons() {
    const btnExportCSV = document.getElementById('btn-export-csv');
    const btnExportJSON = document.getElementById('btn-export-json');
    
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', exportHistoryToCSV);
    }
    
    if (btnExportJSON) {
        btnExportJSON.addEventListener('click', exportHistoryToJSON);
    }
}

function exportHistoryToCSV() {
    if (allHistoryData.length === 0) {
        if (window.Notification) {
            window.Notification.warning('Aviso', 'Nenhum dados para exportar.', 3000);
        }
        return;
    }

    const data = allHistoryData.map(booking => ({
        'Data Reserva': new Date(booking.datetime).toLocaleDateString('pt-PT'),
        'Hora': booking.datetime.split('T')[1],
        'Campo': booking.courtId,
        'Email Utilizador': booking.userEmail,
        'Status': booking.status,
        'Preço': booking.price + '€',
        'Alterado Por': booking.lastModifiedBy || '-',
        'Data Alteração': booking.lastModifiedAt 
            ? new Date(booking.lastModifiedAt.toDate?.() || booking.lastModifiedAt).toLocaleDateString('pt-PT')
            : '-'
    }));

    const filename = `relatorio-reservas-${new Date().toISOString().split('T')[0]}.csv`;
    window.ExportSystem.exportToCSV(data, filename);
    
    if (window.Notification) {
        window.Notification.success('✅ Exportado', `Ficheiro ${filename} descarregado com sucesso!`, 3000);
    }
}

function exportHistoryToJSON() {
    if (allHistoryData.length === 0) {
        if (window.Notification) {
            window.Notification.warning('Aviso', 'Nenhum dados para exportar.', 3000);
        }
        return;
    }

    const data = allHistoryData.map(booking => ({
        datetime: booking.datetime,
        courtId: booking.courtId,
        userEmail: booking.userEmail,
        status: booking.status,
        price: booking.price,
        lastModifiedBy: booking.lastModifiedBy,
        lastModifiedAt: booking.lastModifiedAt?.toDate?.()?.toISOString() || booking.lastModifiedAt,
        modificationHistory: booking.modificationHistory || []
    }));

    const filename = `relatorio-reservas-${new Date().toISOString().split('T')[0]}.json`;
    window.ExportSystem.exportToJSON(data, filename);
    
    if (window.Notification) {
        window.Notification.success('✅ Exportado', `Ficheiro ${filename} descarregado com sucesso!`, 3000);
    }
}

// --- CALENDAR LOGIC ---

function initCalendar() {
    if (!calendarGrid) return; // Safety check

    // Set today
    const today = new Date().toISOString().split('T')[0];
    datePicker.value = today;

    // Listeners
    datePicker.addEventListener('change', loadCalendarBookings);
    prevDayBtn.addEventListener('click', () => changeDate(-1));
    nextDayBtn.addEventListener('click', () => changeDate(1));

    // Initial Load
    loadCalendarBookings();
}

function changeDate(days) {
    const current = new Date(datePicker.value);
    current.setDate(current.getDate() + days);
    datePicker.value = current.toISOString().split('T')[0];
    loadCalendarBookings();
}

function buildGridStructure() {
    // Clear grid but keep headers (first 4 elements)
    calendarGrid.innerHTML = `
        <div class="calendar-header-cell"></div>
        <div class="calendar-header-cell text-center fw-bold text-white">Campo 1 <span class="badge bg-secondary">Indoor</span></div>
        <div class="calendar-header-cell text-center fw-bold text-white">Campo 2 <span class="badge bg-secondary">Indoor</span></div>
        <div class="calendar-header-cell text-center fw-bold text-white">Campo 3 <span class="badge bg-success">Outdoor</span></div>
    `;

    HOURS.forEach(time => {
        // Time Label
        const timeCell = document.createElement('div');
        timeCell.className = 'calendar-time-cell';
        timeCell.textContent = time;
        calendarGrid.appendChild(timeCell);

        // Slots for each court
        COURTS.forEach(court => {
            const slot = document.createElement('div');
            slot.className = 'calendar-slot';
            slot.dataset.time = time;
            slot.dataset.court = court;
            slot.id = `slot-${court.replace(' ', '-')}-${time.replace(':', '-')}`;
            
            // Click to Block
            slot.onclick = () => handleSlotClick(court, time);
            
            calendarGrid.appendChild(slot);
        });
    });
}

async function handleSlotClick(court, time) {
    const slotId = `slot-${court.replace(' ', '-')}-${time.replace(':', '-')}`;
    const slotEl = document.getElementById(slotId);
    
    // Se já tiver filhos (reserva), não faz nada aqui (o filho trata do clique)
    if (slotEl.children.length > 0) return;

    const result = await Swal.fire({
        title: 'Bloquear Horário?',
        text: `Queres bloquear o ${court} às ${time}?`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#475569',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, bloquear',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const dateVal = datePicker.value;
            const finalDateTime = `${dateVal}T${time}`;

            await addDoc(collection(db, "blockedSlots"), {
                date: dateVal,
                time: time,
                courtId: court,
                datetime: finalDateTime,
                blockedBy: 'admin',
                reason: 'Manutenção / Bloqueado',
                createdAt: new Date(),
                timestamp: Date.now()
            });

            Swal.fire('Bloqueado!', 'O horário foi bloqueado.', 'success');
            loadCalendarBookings(); // Recarregar calendário
        } catch (error) {
            console.error("Erro ao bloquear:", error);
            Swal.fire('Erro', 'Não foi possível bloquear.', 'error');
        }
    }
}

function loadCalendarBookings() {
    buildGridStructure(); // Reset grid
    
    const dateVal = datePicker.value;
    if (!dateVal) return;

    const startStr = dateVal;
    const endStr = dateVal + '\uf8ff';

    // Carregar reservas normais
    const qReservas = query(
        collection(db, "reservas"),
        where("datetime", ">=", startStr),
        where("datetime", "<=", endStr)
    );

    // Carregar slots bloqueados
    const qBlocked = query(
        collection(db, "blockedSlots"),
        where("date", "==", dateVal)
    );

    // Listener para reservas
    onSnapshot(qReservas, (snapshot) => {
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const timePart = data.datetime.split('T')[1]; // "14:00"
            const court = data.courtId;
            
            const slotId = `slot-${court.replace(' ', '-')}-${timePart.replace(':', '-')}`;
            const slotEl = document.getElementById(slotId);

            if (slotEl) {
                const badgeClass = 
                    data.status === 'Pendente' ? 'bg-slot-pending' :
                    data.status === 'Aprovado' ? 'bg-slot-approved' : 
                    'bg-slot-rejected';

                const div = document.createElement('div');
                div.className = `calendar-booking ${badgeClass}`;
                div.textContent = `${data.userEmail} (${data.status})`;
                div.title = `User: ${data.userEmail}\nStatus: ${data.status}`;
                
                // Click to manage
                div.onclick = (e) => {
                    e.stopPropagation(); // Prevent slot click
                    showBookingDetails(docSnap.id, data);
                };
                
                slotEl.innerHTML = '';
                slotEl.appendChild(div);
            }
        });
    });

    // Listener para slots bloqueados
    onSnapshot(qBlocked, (snapshot) => {
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const timePart = data.time; // "14:00"
            const court = data.courtId;
            
            const slotId = `slot-${court.replace(' ', '-')}-${timePart.replace(':', '-')}`;
            const slotEl = document.getElementById(slotId);

            if (slotEl) {
                const div = document.createElement('div');
                div.className = 'calendar-booking bg-slot-blocked';
                div.textContent = '🔒 BLOQUEADO';
                div.title = `Motivo: ${data.reason || 'Manutenção'}`;
                
                // Click para desbloquear
                div.onclick = (e) => {
                    e.stopPropagation();
                    unblockSlot(docSnap.id, data);
                };
                
                slotEl.innerHTML = '';
                slotEl.appendChild(div);
            }
        });
    });
}

// Função para desbloquear slot
async function unblockSlot(slotId, data) {
    const result = await Swal.fire({
        title: 'Desbloquear Horário?',
        text: `Queres desbloquear ${data.courtId} às ${data.time}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#84cc16',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, desbloquear',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            await deleteDoc(doc(db, "blockedSlots", slotId));
            Swal.fire('Desbloqueado!', 'O horário foi desbloqueado.', 'success');
            loadCalendarBookings(); // Recarregar
        } catch (error) {
            console.error("Erro ao desbloquear:", error);
            Swal.fire('Erro', 'Não foi possível desbloquear.', 'error');
        }
    }
}

function showBookingDetails(docId, data) {
    Swal.fire({
        title: 'Detalhes da Reserva',
        html: `
            <p><strong>Campo:</strong> ${data.courtId}</p>
            <p><strong>Hora:</strong> ${data.datetime.split('T')[1]}</p>
            <p><strong>Utilizador:</strong> ${data.userEmail}</p>
            <p><strong>Estado Atual:</strong> ${data.status}</p>
        `,
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: 'Aprovar',
        denyButtonText: 'Recusar',
        cancelButtonText: 'Fechar'
    }).then(async (result) => {
        if (result.isConfirmed) {
            await updateStatus(docId, 'Aprovado');
        } else if (result.isDenied) {
            await updateStatus(docId, 'Recusado');
        }
    });
}


// --- EXISTING LOGIC ---

// Variáveis para armazenar filtros
let allPendingBookings = [];

// 2. Carregar Pendentes
function loadPendingBookings() {
    const q = query(
        collection(db, "reservas")
    );

    onSnapshot(q, (snapshot) => {
        // Guardar todas as reservas
        allPendingBookings = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        
        // Aplicar filtros e renderizar
        applyPendingFilters();
    });
}

// Função para aplicar filtros
function applyPendingFilters() {
    let filtered = [...allPendingBookings];
    
    // Filtro por Status
    const statusFilter = document.getElementById('filter-status')?.value || '';
    if (statusFilter) {
        filtered = filtered.filter(b => b.status === statusFilter);
    } else {
        // Se não houver filtro de status, mostrar só Pendentes
        filtered = filtered.filter(b => b.status === 'Pendente');
    }
    
    // Filtro por Campo
    const courtFilter = document.getElementById('filter-court')?.value || '';
    if (courtFilter) {
        filtered = filtered.filter(b => b.courtId === courtFilter);
    }
    
    // Filtro por Data (De)
    const dateFromFilter = document.getElementById('filter-date-from')?.value || '';
    if (dateFromFilter) {
        filtered = filtered.filter(b => b.datetime.split('T')[0] >= dateFromFilter);
    }
    
    // Filtro por Data (Até)
    const dateToFilter = document.getElementById('filter-date-to')?.value || '';
    if (dateToFilter) {
        filtered = filtered.filter(b => b.datetime.split('T')[0] <= dateToFilter);
    }
    
    // Renderizar resultados filtrados
    renderPendingBookings(filtered);
}

function renderPendingBookings(bookings) {
    if (!pendingList) return;
    
    pendingList.innerHTML = '';
    
    if (bookings.length === 0) {
        pendingList.innerHTML = `
            <div class="col-12 text-center text-secondary py-5">
                <i class="bi bi-inbox fs-1 mb-3 d-block"></i>
                <p>Nenhuma reserva encontrada com esses filtros.</p>
            </div>`;
        return;
    }

    bookings.forEach((booking) => {
        const card = createPendingCard(booking.id, booking);
        pendingList.appendChild(card);
    });
}

// Event listeners para filtros
document.addEventListener('DOMContentLoaded', () => {
    const filterCourt = document.getElementById('filter-court');
    const filterStatus = document.getElementById('filter-status');
    const filterDateFrom = document.getElementById('filter-date-from');
    const filterDateTo = document.getElementById('filter-date-to');
    const btnClearFilters = document.getElementById('btn-clear-filters');
    
    if (filterCourt) filterCourt.addEventListener('change', applyPendingFilters);
    if (filterStatus) filterStatus.addEventListener('change', applyPendingFilters);
    if (filterDateFrom) filterDateFrom.addEventListener('change', applyPendingFilters);
    if (filterDateTo) filterDateTo.addEventListener('change', applyPendingFilters);
    
    if (btnClearFilters) {
        btnClearFilters.addEventListener('click', () => {
            if (filterCourt) filterCourt.value = '';
            if (filterStatus) filterStatus.value = '';
            if (filterDateFrom) filterDateFrom.value = '';
            if (filterDateTo) filterDateTo.value = '';
            applyPendingFilters();
        });
    }
});

// 3. Carregar Histórico
function loadHistoryBookings() {
    const q = query(
        collection(db, "reservas"),
        where("status", "in", ["Aprovado", "Recusado"]),
        limit(20)
    );

    onSnapshot(q, (snapshot) => {
        historyList.innerHTML = '';
        allHistoryData = [];
        
        if (snapshot.empty) {
            historyList.innerHTML = '<tr><td colspan="6" class="text-center py-3 text-secondary">Sem histórico recente.</td></tr>';
            return;
        }

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            allHistoryData.push(data);
            const row = createHistoryRow(data);
            historyList.appendChild(row);
        });
    });
}

// Helper: Criar HTML do Cartão Pendente
function createPendingCard(docId, data) {
    const col = document.createElement('div');
    col.className = 'col-md-6 col-lg-4';
    
    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long' });
    const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    col.innerHTML = `
        <div class="card card-custom h-100">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start mb-3">
                    <div>
                        <h5 class="card-title text-white mb-1">${data.courtId || 'Campo'}</h5>
                        <div class="text-padel fw-bold">${timeStr}</div>
                    </div>
                    <span class="badge badge-pending">Pendente</span>
                </div>
                
                <div class="mb-4">
                    <div class="d-flex align-items-center text-secondary mb-2">
                        <i class="bi bi-calendar3 me-2"></i> ${dateStr}
                    </div>
                    <div class="d-flex align-items-center text-secondary">
                        <i class="bi bi-person me-2"></i> ${data.userEmail || 'Sem email'}
                    </div>
                </div>

                <div class="d-flex gap-2">
                    <button onclick="updateStatus('${docId}', 'Recusado')" class="btn btn-reject flex-grow-1">
                        <i class="bi bi-x-lg"></i> Recusar
                    </button>
                    <button onclick="updateStatus('${docId}', 'Aprovado')" class="btn btn-approve flex-grow-1">
                        <i class="bi bi-check-lg"></i> Aprovar
                    </button>
                </div>
            </div>
        </div>
    `;
    return col;
}

// Helper: Criar Linha da Tabela de Histórico
function createHistoryRow(data) {
    const tr = document.createElement('tr');
    
    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT') + ' ' + dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    // Data da última alteração
    const lastModifiedAt = data.lastModifiedAt?.toDate?.() || new Date(data.lastModifiedAt);
    const modifiedStr = lastModifiedAt.toLocaleDateString('pt-PT') + ' ' + lastModifiedAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    let badgeClass = data.status === 'Aprovado' ? 'badge-approved' : 'badge-rejected';

    tr.innerHTML = `
        <td class="text-white small">${dateStr}</td>
        <td class="text-white">${data.courtId || '-'}</td>
        <td class="text-secondary">${data.userEmail || '-'}</td>
        <td><span class="badge ${badgeClass}">${data.status}</span></td>
        <td class="text-secondary small">${data.lastModifiedBy || '-'}</td>
        <td class="text-secondary small">${modifiedStr || '-'}</td>
    `;
    return tr;
}

// 4. Função Global para Atualizar Status
window.updateStatus = async (docId, newStatus) => {
    try {
        // 1. Buscar dados da reserva antes de atualizar (para enviar email)
        const bookingRef = doc(db, "reservas", docId);
        const bookingSnap = await getDoc(bookingRef);
        
        if (!bookingSnap.exists()) {
            throw new Error("Reserva não encontrada");
        }
        
        const bookingData = bookingSnap.data();

        // 2. Atualizar Status + Registar quem alterou e quando
        const adminEmail = auth.currentUser?.email || 'Admin';
        
        await updateDoc(bookingRef, {
            status: newStatus,
            lastModifiedBy: adminEmail,
            lastModifiedAt: new Date(),
            modificationHistory: [
                ...(bookingData.modificationHistory || []),
                {
                    status: newStatus,
                    changedBy: adminEmail,
                    changedAt: new Date(),
                    timestamp: new Date().toISOString()
                }
            ]
        });
        
        // 3. Enviar Email (Sem bloquear a UI)
        sendEmailNotification(bookingData.userEmail, newStatus, bookingData);

        // 4. Notificação In-App
        if (window.Notification) {
            const titulo = newStatus === 'Aprovado' ? '✅ Reserva Aprovada' : '❌ Reserva Recusada';
            const msg = `${bookingData.userEmail} - ${bookingData.courtId} às ${bookingData.datetime.split('T')[1]}`;
            window.Notification.success(titulo, msg, 5000);
        }

        Swal.fire({
            title: 'Atualizado!',
            text: `A reserva foi marcada como ${newStatus} e o email foi enviado.`,
            icon: 'success',
            timer: 2000,
            showConfirmButton: false
        });
        
    } catch (error) {
        console.error("Erro ao atualizar:", error);
        
        // Notificação de erro
        if (window.Notification) {
            window.Notification.error('Erro', 'Não foi possível atualizar a reserva.', 5000);
        }
        
        Swal.fire('Erro', 'Erro ao atualizar reserva: ' + error.message, 'error');
    }
};

// --- GESTÃO DE CANCELAMENTOS ---

function loadCancellationNotifications() {
    const cancellationsList = document.getElementById('cancellations-list');
    const historyList = document.getElementById('cancellations-history-list');
    const badge = document.getElementById('cancellation-badge');
    const pendingCount = document.getElementById('pending-cancellations-count');
    
    if (!cancellationsList || !historyList) return;

    // Query para notificações pendentes
    const qPending = query(
        collection(db, "cancellationNotifications"),
        where("status", "==", "pending"),
        orderBy("cancelledAt", "desc")
    );

    // Query para histórico (processadas)
    const qHistory = query(
        collection(db, "cancellationNotifications"),
        where("status", "in", ["freed", "kept-blocked"]),
        orderBy("processedAt", "desc"),
        limit(50)
    );

    // Listener para pendentes
    onSnapshot(qPending, (snapshot) => {
        cancellationsList.innerHTML = '';
        
        if (snapshot.empty) {
            cancellationsList.innerHTML = `
                <div class="col-12 text-center text-secondary py-5">
                    <i class="bi bi-check-circle fs-1"></i>
                    <p class="mt-2">Nenhum cancelamento pendente! 🎉</p>
                </div>
            `;
            if (badge) badge.style.display = 'none';
            if (pendingCount) pendingCount.textContent = '0';
        } else {
            const count = snapshot.size;
            if (badge) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            }
            if (pendingCount) pendingCount.textContent = count;

            snapshot.forEach(doc => {
                const data = doc.data();
                const card = createCancellationCard(doc.id, data);
                cancellationsList.appendChild(card);
            });
        }
    });

    // Listener para histórico
    onSnapshot(qHistory, (snapshot) => {
        historyList.innerHTML = '';
        
        if (snapshot.empty) {
            historyList.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center text-secondary py-4">
                        Nenhum cancelamento processado ainda
                    </td>
                </tr>
            `;
        } else {
            snapshot.forEach(doc => {
                const data = doc.data();
                const row = createCancellationHistoryRow(data);
                historyList.appendChild(row);
            });
        }
    });
}

function createCancellationCard(notificationId, data) {
    const col = document.createElement('div');
    col.className = 'col-lg-6 col-xl-4';
    
    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const cancelledAt = data.cancelledAt?.toDate?.() || new Date(data.cancelledAt);
    const cancelledStr = cancelledAt.toLocaleDateString('pt-PT') + ' às ' + cancelledAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    // Verificar se a data já passou
    const isPast = dateObj < new Date();
    const pastWarning = isPast ? `
        <div class="alert alert-warning bg-opacity-10 border border-warning p-2 small mt-2">
            <i class="bi bi-exclamation-triangle"></i> Esta marcação já passou
        </div>
    ` : '';

    col.innerHTML = `
        <div class="card card-custom p-4">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <span class="badge bg-danger mb-2">Cancelado</span>
                    <h5 class="text-white mb-1">${data.courtId}</h5>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-calendar-event"></i> ${dateStr}
                    </p>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-clock"></i> ${timeStr}
                    </p>
                </div>
                <div class="text-end">
                    <p class="text-padel fs-5 fw-bold mb-0">${data.price || 0}€</p>
                </div>
            </div>
            
            <div class="border-top border-secondary pt-3 mb-3">
                <p class="text-white small mb-1">
                    <i class="bi bi-person-fill"></i> ${data.userName || data.userEmail}
                </p>
                <p class="text-secondary small mb-0">
                    <i class="bi bi-envelope"></i> ${data.userEmail}
                </p>
                <p class="text-secondary small mb-0">
                    <i class="bi bi-x-circle"></i> Cancelado: ${cancelledStr}
                </p>
            </div>
            
            ${pastWarning}
            
            <div class="alert alert-info bg-opacity-10 border border-info p-2 small mb-3">
                <strong>O que queres fazer com este horário?</strong>
            </div>
            
            <div class="d-grid gap-2">
                <button onclick="processCancellation('${notificationId}', '${data.datetime}', '${data.courtId}', 'freed')" 
                        class="btn btn-success">
                    <i class="bi bi-unlock-fill"></i> Libertar Horário
                </button>
                <button onclick="processCancellation('${notificationId}', '${data.datetime}', '${data.courtId}', 'kept-blocked')" 
                        class="btn btn-outline-secondary">
                    <i class="bi bi-lock-fill"></i> Manter Bloqueado
                </button>
            </div>
        </div>
    `;
    
    return col;
}

function createCancellationHistoryRow(data) {
    const tr = document.createElement('tr');
    
    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT') + ' ' + dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const cancelledAt = data.cancelledAt?.toDate?.() || new Date(data.cancelledAt);
    const cancelledStr = cancelledAt.toLocaleDateString('pt-PT') + ' ' + cancelledAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const processedAt = data.processedAt?.toDate?.() || new Date(data.processedAt);
    const processedStr = processedAt.toLocaleDateString('pt-PT') + ' ' + processedAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const decisionBadge = data.status === 'freed' 
        ? '<span class="badge bg-success"><i class="bi bi-unlock-fill"></i> Libertado</span>'
        : '<span class="badge bg-secondary"><i class="bi bi-lock-fill"></i> Mantido Bloqueado</span>';

    tr.innerHTML = `
        <td class="text-white small">${dateStr}</td>
        <td class="text-white">${data.courtId}</td>
        <td class="text-secondary">${data.userName || data.userEmail}</td>
        <td class="text-secondary small">${cancelledStr}</td>
        <td>${decisionBadge}</td>
        <td class="text-secondary small">${processedStr}</td>
    `;
    
    return tr;
}

// Função Global para processar cancelamento
window.processCancellation = async (notificationId, datetime, courtId, decision) => {
    const actionText = decision === 'freed' ? 'libertar este horário' : 'manter este horário bloqueado';
    const confirmText = decision === 'freed' ? 'Sim, libertar' : 'Sim, manter bloqueado';
    
    const result = await Swal.fire({
        title: 'Confirmar Decisão',
        text: `Tens a certeza que queres ${actionText}?`,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: decision === 'freed' ? '#22c55e' : '#64748b',
        cancelButtonColor: '#334155',
        confirmButtonText: confirmText,
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const adminEmail = auth.currentUser?.email || 'Admin';
            
            // Atualizar notificação
            await updateDoc(doc(db, "cancellationNotifications", notificationId), {
                status: decision,
                processedAt: new Date(),
                processedBy: adminEmail,
                viewed: true
            });

            // Se decidiu manter bloqueado, criar um bloqueio
            if (decision === 'kept-blocked') {
                const [dateVal, timeVal] = datetime.split('T');
                
                await addDoc(collection(db, "blockedSlots"), {
                    date: dateVal,
                    time: timeVal,
                    courtId: courtId,
                    datetime: datetime,
                    blockedBy: adminEmail,
                    reason: 'Horário mantido ocupado após cancelamento',
                    createdAt: new Date(),
                    timestamp: Date.now()
                });
            }

            Swal.fire({
                title: 'Processado!',
                text: decision === 'freed' 
                    ? 'O horário foi libertado e está disponível para novas reservas.' 
                    : 'O horário foi mantido bloqueado.',
                icon: 'success',
                timer: 3000,
                showConfirmButton: false
            });

            if (window.Notification) {
                window.Notification.success(
                    '✅ Decisão Guardada', 
                    `${courtId} - ${datetime.split('T')[1]}`, 
                    3000
                );
            }

        } catch (error) {
            console.error("Erro ao processar cancelamento:", error);
            Swal.fire('Erro', 'Não foi possível processar a decisão: ' + error.message, 'error');
        }
    }
};

// Função para enviar email via EmailJS
function sendEmailNotification(email, status, data) {
    // Configuração do Template
    // Tens de criar um template no EmailJS com estas variáveis:
    // {{to_email}}, {{status}}, {{court}}, {{date}}, {{time}}
    
    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT');
    const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

    const templateParams = {
        to_email: email,
        status: status,
        court: data.courtId,
        date: dateStr,
        time: timeStr,
        message: status === 'Aprovado' 
            ? 'A tua reserva foi confirmada! Não te esqueças de chegar 10min antes.' 
            : 'Infelizmente não foi possível aceitar a tua reserva para este horário.'
    };

    emailjs.send('service_x9s8d7f', 'template_gheieu8', templateParams)
        .then(function(response) {
            console.log('Email enviado com sucesso!', response.status, response.text);
        }, function(error) {
            console.error('FALHA ao enviar email...', error);
        });
}
