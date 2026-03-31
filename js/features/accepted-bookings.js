import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { collection, query, orderBy, limit, onSnapshot, getDoc, doc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

const listEl = document.getElementById('accepted-bookings-list');
const totalEl = document.getElementById('accepted-total');
const todayEl = document.getElementById('accepted-today');
const weekEl = document.getElementById('accepted-week');
const updatedAtEl = document.getElementById('accepted-updated-at');
const refreshBtn = document.getElementById('btn-refresh-accepted');

let unsubscribeAccepted = null;

function formatDateTimeParts(datetime) {
    const dt = new Date(datetime);
    return {
        date: dt.toLocaleDateString('pt-PT'),
        time: dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })
    };
}

function isSameDay(dateA, dateB) {
    return dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate();
}

function getWeekStart(date) {
    const start = new Date(date);
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diffToMonday);
    start.setHours(0, 0, 0, 0);
    return start;
}

function renderRows(bookings) {
    if (!listEl) return;

    if (!bookings.length) {
        listEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-secondary">Sem reservas aceites recentes.</td></tr>';
        return;
    }

    listEl.innerHTML = bookings.map(booking => {
        const { date, time } = formatDateTimeParts(booking.datetime);
        const userName = booking.userName || booking.resolvedUserName || booking.userEmail?.split('@')[0] || '-';
        const userEmail = booking.userEmail || '-';
        const paymentMethod = booking.paymentMethod || '-';
        const price = Number(booking.price || 0).toFixed(2);

        return `
            <tr>
                <td class="p-3 text-secondary">${date}</td>
                <td class="p-3 text-white">${time}</td>
                <td class="p-3 text-white">${booking.courtId || 'Campo'}</td>
                <td class="p-3 text-white">${userName}</td>
                <td class="p-3 text-secondary">${userEmail}</td>
                <td class="p-3 text-padel fw-bold">${price}EUR</td>
                <td class="p-3 text-secondary">${paymentMethod}</td>
            </tr>
        `;
    }).join('');
}

function renderSummary(bookings) {
    const now = new Date();
    const weekStart = getWeekStart(now);

    const acceptedToday = bookings.filter(booking => isSameDay(new Date(booking.datetime), now)).length;
    const acceptedWeek = bookings.filter(booking => new Date(booking.datetime) >= weekStart).length;

    if (totalEl) totalEl.textContent = `${bookings.length} reservas`;
    if (todayEl) todayEl.textContent = acceptedToday;
    if (weekEl) weekEl.textContent = acceptedWeek;
    if (updatedAtEl) {
        updatedAtEl.textContent = now.toLocaleDateString('pt-PT') + ' ' + now.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    }
}

function listenAcceptedBookings() {
    if (unsubscribeAccepted) unsubscribeAccepted();

    const acceptedQuery = query(
        collection(db, 'reservas'),
        orderBy('datetime', 'desc'),
        limit(250)
    );

    unsubscribeAccepted = onSnapshot(acceptedQuery, (snapshot) => {
        const bookings = snapshot.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .filter(item => item.datetime)
            .filter(item => item.status === 'Aprovado')
            .slice(0, 50);

        renderRows(bookings);
        renderSummary(bookings);
    }, (error) => {
        console.error('Erro ao carregar reservas aceites:', error);
        if (listEl) {
            listEl.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-danger">Erro ao carregar reservas aceites.</td></tr>';
        }
    });
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = 'index.html';
        return;
    }

    try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const userData = userSnap.exists() ? userSnap.data() : null;
        const isAdmin = userData?.isAdmin === true || userData?.role === 'admin';

        if (!isAdmin) {
            window.location.href = 'dashboard.html';
            return;
        }

        listenAcceptedBookings();
    } catch (error) {
        console.error('Erro ao validar permissões:', error);
        window.location.href = 'index.html';
    }
});

if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        listenAcceptedBookings();
        if (window.Notification) {
            window.Notification.info('Atualizado', 'Lista de reservas aceites atualizada.', 2500);
        }
    });
}
