import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, onSnapshot, deleteDoc, doc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let calendar;
let allEvents = [];
let isLoading = false;
let currentUser = null;
let focusDateParam = null;
let focusApplied = false;
let unsubscribeReservations = null;

// Inicializar calendário
document.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    if (focus) {
        const parsed = new Date(focus);
        if (!Number.isNaN(parsed.getTime())) {
            focusDateParam = parsed;
        }
    }

    const calendarEl = document.getElementById('calendar');
    const initialView = focusDateParam ? 'timeGridDay' : 'dayGridMonth';
    const initialDate = focusDateParam || undefined;
    const initialScrollTime = focusDateParam ? formatTime(focusDateParam) : '08:00:00';
    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView,
        initialDate,
        scrollTime: initialScrollTime,
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
        },
        locale: 'pt',
        buttonText: {
            today: 'Hoje',
            month: 'Mês',
            week: 'Semana',
            day: 'Dia',
            list: 'Lista'
        },
        slotMinTime: '08:00:00',
        slotMaxTime: '23:00:00',
        allDaySlot: false,
        height: 'auto',
        events: [],
        eventClick: function(info) {
            showEventDetails(info.event);
        },
        eventDidMount: function(info) {
            // Adicionar classes de status
            const statusKey = info.event.extendedProps.statusKey;
            if (statusKey) info.el.classList.add(`fc-event-${statusKey}`);
            // Tooltip simples via title
            const r = info.event.extendedProps;
            const startStr = r.startDate ? new Date(r.startDate).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '';
            info.el.title = `${info.event.title}\n${startStr}\nStatus: ${r.statusLabel || '—'}`;
        }
    });
    
    calendar.render();
    
    // Iniciar Meteorologia
    fetchWeather();
});

// Autenticação
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        loadReservations(true);
        
        // Atualizar nome do utilizador na sidebar se disponível
        const userNameEl = document.getElementById('user-name');
        if (userNameEl) {
             // Tentar obter nome do email ou esperar que o profile carregue (este script é simples)
             userNameEl.textContent = user.displayName || user.email.split('@')[0];
        }
    } else {
        window.location.href = 'index.html';
    }
});

// Carregar reservas
function setLoading(state){
    isLoading = state;
    const el = document.getElementById('calendar-loading');
    if (el) el.style.display = state ? 'block' : 'none';
}

function loadReservations(forceOnlyMine = false) {
    setLoading(true);
    const showOnlyMine = forceOnlyMine || document.getElementById('show-only-mine').checked;
    
    let q;
    if (showOnlyMine) {
        q = query(
            collection(db, "reservas"),
            where("userId", "==", currentUser.uid)
        );
    } else {
        q = query(collection(db, "reservas"));
    }

    if (typeof unsubscribeReservations === 'function') {
        unsubscribeReservations();
    }
    
    unsubscribeReservations = onSnapshot(q, (snapshot) => {
        allEvents = [];
        
        snapshot.forEach(docSnap => {
            const event = buildEventFromReserva(docSnap);
            if (event) allEvents.push(event);
        });
        
        applyFilters();
        setLoading(false);
    });
}

// Construir evento normalizado a partir do documento
function buildEventFromReserva(docSnap) {
    const reserva = docSnap.data();
    const startDate = getReservaStartDate(reserva);
    if (!startDate) return null;

    const endDate = new Date(startDate);
    endDate.setMinutes(endDate.getMinutes() + 90);

    const statusLabel = reserva.status || 'Pendente';
    const statusKey = normalizeStatus(statusLabel);

    return {
        id: docSnap.id,
        title: `${reserva.courtId || reserva.court || 'Campo'} - ${reserva.userName || reserva.userEmail || 'Utilizador'}`,
        start: startDate,
        end: endDate,
        extendedProps: {
            ...reserva,
            startDate,
            statusKey,
            statusLabel,
            reservaId: docSnap.id
        }
    };
}

function getReservaStartDate(reserva) {
    if (reserva.datetime) {
        const d = new Date(reserva.datetime);
        if (!Number.isNaN(d.getTime())) return d;
    }
    if (reserva.date && reserva.time) {
        const d = new Date(`${reserva.date}T${reserva.time}`);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
}

function normalizeStatus(status) {
    const val = (status || '').toString().toLowerCase();
    if (val.includes('aprov')) return 'approved';
    if (val.includes('pend')) return 'pending';
    if (val.includes('reje') || val.includes('recus')) return 'rejected';
    if (val.includes('cancel')) return 'cancelled';
    return val || 'pending';
}

// Aplicar filtros
function applyFilters() {
    const courtFilter = document.getElementById('filter-court').value;
    const statusFilter = document.getElementById('filter-status').value;
    
    let filteredEvents = allEvents;
    
    if (courtFilter) {
        filteredEvents = filteredEvents.filter(e => {
            const eventCourt = e.extendedProps.courtId || e.extendedProps.court;
            return eventCourt === courtFilter;
        });
    }
    
    if (statusFilter) {
        filteredEvents = filteredEvents.filter(e => e.extendedProps.statusKey === statusFilter);
    }
    
        calendar.removeAllEvents();
        calendar.addEventSource(filteredEvents);

        applyFocusIfNeeded(filteredEvents);

        // Empty state
        const emptyMsgId = 'calendar-empty-msg';
        let empty = document.getElementById(emptyMsgId);
        if (!filteredEvents.length && !isLoading) {
            if (!empty) {
                empty = document.createElement('div');
                empty.id = emptyMsgId;
                empty.className = 'text-secondary mt-3';
                empty.textContent = 'Sem eventos para mostrar.';
                document.getElementById('calendar').after(empty);
            }
        } else if (empty) {
            empty.remove();
        }
}

function applyFocusIfNeeded(events) {
    if (!focusDateParam || focusApplied) return;
    const targetDate = new Date(focusDateParam);
    if (Number.isNaN(targetDate.getTime())) return;

    calendar.gotoDate(targetDate);
    calendar.changeView('timeGridDay');
    if (calendar.scrollToTime) {
        calendar.scrollToTime(formatTime(targetDate));
    }

    const targetEvent = events.find(e => {
        const start = new Date(e.start);
        return !Number.isNaN(start.getTime()) && isSameMinute(start, targetDate);
    });

    if (targetEvent) {
        const eventApi = calendar.getEventById(targetEvent.id);
        if (eventApi) {
            const currentClasses = eventApi.classNames || [];
            eventApi.setProp('classNames', [...currentClasses, 'fc-event-focus']);
        }
    }

    focusApplied = true;
}

function isSameMinute(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate() &&
        a.getHours() === b.getHours() &&
        a.getMinutes() === b.getMinutes();
}

function formatTime(dateObj) {
    return dateObj.toTimeString().slice(0, 8);
}

// Mostrar detalhes do evento
function showEventDetails(event) {
    const props = event.extendedProps;
    const statusKey = props.statusKey || normalizeStatus(props.status || props.statusLabel);
    const statusLabels = {
        approved: 'Aprovado',
        pending: 'Pendente',
        rejected: 'Recusado',
        cancelled: 'Cancelado'
    };
    const statusColors = {
        approved: 'success',
        pending: 'warning',
        rejected: 'danger',
        cancelled: 'secondary'
    };
    const badgeHtml = statusColors[statusKey]
        ? `<span class="badge bg-${statusColors[statusKey]}">${statusLabels[statusKey] || props.statusLabel || statusKey}</span>`
        : (props.statusLabel || props.status || '—');

    const startDate = props.startDate ? new Date(props.startDate) : event.start;
    const dateStr = startDate ? startDate.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : (props.date || '—');
    const timeStr = startDate ? startDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : (props.time || '—');
    const userLabel = props.userName || props.userEmail || 'N/A';

    const detailsHtml = `
        <div class="mb-3">
            <strong>Campo:</strong> ${props.courtId || props.court || 'Campo'}<br>
            <strong>Data:</strong> ${dateStr}<br>
            <strong>Hora:</strong> ${timeStr}<br>
            <strong>Utilizador:</strong> ${userLabel}<br>
            <strong>Status:</strong> ${badgeHtml}
        </div>
        ${props.userId === currentUser.uid ? `
            <button class="btn btn-danger btn-sm w-100" onclick="cancelReservation('${props.reservaId}')">
                <i class="bi bi-trash"></i> Cancelar Reserva
            </button>
        ` : ''}
    `;
    
    document.getElementById('event-details').innerHTML = detailsHtml;
    new bootstrap.Modal(document.getElementById('eventModal')).show();
}

// Event Listeners
document.getElementById('filter-court')?.addEventListener('change', applyFilters);
document.getElementById('filter-status')?.addEventListener('change', applyFilters);
document.getElementById('show-only-mine')?.addEventListener('change', loadReservations);

document.getElementById('view-mode')?.addEventListener('change', (e) => {
    calendar.changeView(e.target.value);
});

// Logout Logic handled by sidebar script
// document.getElementById('logout-btn')?.addEventListener...

// Função global para cancelar reserva
window.cancelReservation = async function(reservaId) {
    // Esta função já existe no dashboard.js, podemos importar ou recriar
    const confirm = await Swal.fire({
        title: 'Cancelar Reserva?',
        text: 'Esta ação não pode ser revertida.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#ef4444',
        cancelButtonColor: '#6b7280',
        confirmButtonText: 'Sim, cancelar',
        cancelButtonText: 'Não'
    });
    
    if (confirm.isConfirmed) {
        try {
            await deleteDoc(doc(db, "reservas", reservaId));
            Swal.fire('Cancelada!', 'Reserva cancelada com sucesso.', 'success');
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
        } catch (error) {
            console.error('Erro ao cancelar:', error);
            Swal.fire('Erro', 'Não foi possível cancelar a reserva.', 'error');
        }
    }
};

// --- Função Meteorologia (Open-Meteo API) ---
async function fetchWeather() {
    try {
        const lat = 41.1579;
        const lon = -8.6291;

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`;
        const response = await fetch(url);
        const data = await response.json();

        const temp = Math.round(data.current.temperature_2m);
        const code = data.current.weather_code;

        let desc = 'Céu Limpo';
        let iconClass = 'bi-sun-fill';

        if (code >= 1 && code <= 3) {
            desc = 'Parcialmente Nublado';
            iconClass = 'bi-cloud-sun-fill';
        } else if (code >= 45 && code <= 48) {
            desc = 'Nevoeiro';
            iconClass = 'bi-cloud-haze-fill';
        } else if (code >= 51 && code <= 67) {
            desc = 'Chuva Fraca';
            iconClass = 'bi-cloud-drizzle-fill';
        } else if (code >= 80 && code <= 99) {
            desc = 'Chuva Forte / Trovoada';
            iconClass = 'bi-cloud-lightning-rain-fill';
        } else if (code >= 71) {
            desc = 'Neve';
            iconClass = 'bi-snow';
        }

        const sidebarTemp = document.getElementById('weather-temp-sidebar');
        const sidebarDesc = document.getElementById('weather-desc-sidebar');
        const sidebarIcon = document.getElementById('weather-icon-sidebar');

        if (sidebarTemp) sidebarTemp.textContent = temp + '°C';
        if (sidebarDesc) sidebarDesc.textContent = desc;
        if (sidebarIcon) {
            sidebarIcon.className = 'bi ' + iconClass + ' text-info';
        }

    } catch (error) {
        console.error('Erro ao buscar meteorologia:', error);
        const sidebarDesc = document.getElementById('weather-desc-sidebar');
        if (sidebarDesc) sidebarDesc.textContent = 'Indisponível';
    }
}
