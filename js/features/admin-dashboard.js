import { auth, db } from '../core/firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, onSnapshot, doc, updateDoc, getDoc, getDocs, orderBy, limit, addDoc, deleteDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const pendingList = document.getElementById('pending-list');
const historyList = document.getElementById('history-list');
const userProfileCache = new Map();
const logsList = document.getElementById('logs-list');
const logsTotalCount = document.getElementById('logs-total-count');

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

const DEFAULT_PRICING = {
    courts: {
        'Campo 1': 20,
        'Campo 2': 20,
        'Campo 3': 15
    },
    eveningStartHour: 18,
    eveningSurcharge: 5
};

const BILLING_COMPANY_PROFILE = {
    legalName: '',
    taxId: '',
    address: '',
    phone: '',
    email: '',
    website: ''
};
let billingCompanyProfile = { ...BILLING_COMPANY_PROFILE };

let pricingSettings = { ...DEFAULT_PRICING, courts: { ...DEFAULT_PRICING.courts } };

async function getCurrentActorMeta() {
    const actorId = auth.currentUser?.uid || '';
    const actorEmail = auth.currentUser?.email || '';

    let actorName = actorEmail ? actorEmail.split('@')[0] : 'Utilizador';
    let actorRole = 'client';
    let actorIsAdmin = false;

    if (actorId) {
        try {
            const userSnap = await getDoc(doc(db, 'users', actorId));
            if (userSnap.exists()) {
                const userData = userSnap.data();
                actorName = userData.name || actorName;
                actorIsAdmin = userData.isAdmin === true || userData.role === 'admin';
                actorRole = actorIsAdmin ? 'admin' : 'client';
            }
        } catch (error) {
            console.error('Erro ao obter dados do ator para logs:', error);
        }
    }

    return { actorId, actorEmail, actorName, actorRole, actorIsAdmin };
}

async function logActivity(action, details, meta = {}) {
    try {
        const actor = await getCurrentActorMeta();
        await addDoc(collection(db, 'activityLogs'), {
            action,
            details: details || '',
            targetType: meta.targetType || '',
            targetId: meta.targetId || '',
            actorId: actor.actorId,
            actorEmail: actor.actorEmail,
            actorName: actor.actorName,
            actorRole: actor.actorRole,
            actorIsAdmin: actor.actorIsAdmin,
            source: meta.source || 'admin-dashboard',
            timestamp: new Date()
        });
    } catch (error) {
        console.error('Falha ao gravar log de atividade:', error);
    }
}

function loadActivityLogs() {
    if (!logsList) return;

    const qLogs = query(collection(db, 'activityLogs'), orderBy('timestamp', 'desc'), limit(300));

    onSnapshot(qLogs, async (snapshot) => {
        const entries = await Promise.all(snapshot.docs.map(async (docSnap) => {
            const data = docSnap.data();
            if ((!data.actorName || !data.actorEmail) && data.actorId) {
                const profile = await getUserProfile(data.actorId);
                return {
                    id: docSnap.id,
                    ...data,
                    actorName: data.actorName || profile.name || 'Utilizador',
                    actorEmail: data.actorEmail || profile.email || 'Sem email'
                };
            }

            return {
                id: docSnap.id,
                ...data,
                actorName: data.actorName || 'Utilizador',
                actorEmail: data.actorEmail || 'Sem email'
            };
        }));

        const legacyEntries = await buildLegacyLogs();
        const mergedEntries = mergeAndSortLogs(entries, legacyEntries);

        if (logsTotalCount) {
            logsTotalCount.textContent = `${mergedEntries.length} registos`;
        }

        if (mergedEntries.length === 0) {
            logsList.innerHTML = '<tr><td colspan="5" class="text-center text-secondary py-4">Sem logs de atividade.</td></tr>';
            return;
        }

        logsList.innerHTML = mergedEntries.map(entry => {
            const dt = entry.timestamp?.toDate?.() || new Date(entry.timestamp);
            const dateStr = dt.toLocaleDateString('pt-PT') + ' ' + dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
            const isAdmin = entry.actorIsAdmin === true || entry.actorRole === 'admin';
            const profileBadge = isAdmin
                ? '<span class="badge bg-danger">ADMIN</span>'
                : '<span class="badge bg-info text-dark">CLIENTE</span>';
            const actorClass = isAdmin ? 'text-warning fw-bold' : 'text-white';

            return `
                <tr>
                    <td class="text-secondary small">${dateStr}</td>
                    <td>
                        <div class="${actorClass}">${entry.actorName}</div>
                        <div class="text-secondary small">${entry.actorEmail}</div>
                    </td>
                    <td>${profileBadge}</td>
                    <td class="text-white">${entry.action || '-'}</td>
                    <td class="text-secondary small">${entry.details || '-'}</td>
                </tr>
            `;
        }).join('');
    });
}

function toDateSafe(value) {
    if (!value) return null;
    if (typeof value?.toDate === 'function') return value.toDate();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function createLogKey(entry) {
    const dt = toDateSafe(entry.timestamp);
    const ts = dt ? dt.getTime() : 0;
    return `${entry.action || ''}|${entry.details || ''}|${entry.actorEmail || ''}|${ts}`;
}

function mergeAndSortLogs(primaryLogs, legacyLogs) {
    const map = new Map();
    [...primaryLogs, ...legacyLogs].forEach(entry => {
        const key = createLogKey(entry);
        if (!map.has(key)) map.set(key, entry);
    });

    return [...map.values()]
        .filter(entry => toDateSafe(entry.timestamp))
        .sort((a, b) => toDateSafe(b.timestamp) - toDateSafe(a.timestamp))
        .slice(0, 400);
}

async function buildLegacyLogs() {
    const legacy = [];

    try {
        const reservasSnap = await getDocs(query(collection(db, 'reservas'), limit(500)));
        reservasSnap.forEach(docSnap => {
            const data = docSnap.data();
            const actorEmail = data.userEmail || 'Sem email';
            const actorName = data.userName || actorEmail.split('@')[0] || 'Cliente';

            const createdAt = toDateSafe(data.timestamp);
            if (createdAt) {
                legacy.push({
                    timestamp: createdAt,
                    actorName,
                    actorEmail,
                    actorRole: 'client',
                    actorIsAdmin: false,
                    action: 'Criou reserva',
                    details: `${data.courtId || 'Campo'} em ${data.datetime || '-'}`
                });
            }

            const cancelledAt = toDateSafe(data.cancelledAt);
            if (cancelledAt) {
                legacy.push({
                    timestamp: cancelledAt,
                    actorName,
                    actorEmail,
                    actorRole: 'client',
                    actorIsAdmin: false,
                    action: 'Cancelou reserva',
                    details: `${data.courtId || 'Campo'} em ${data.datetime || '-'}`
                });
            }

            (data.modificationHistory || []).forEach(change => {
                const changeDate = toDateSafe(change.changedAt || change.timestamp);
                if (!changeDate) return;

                const adminEmail = change.changedBy || 'admin';
                legacy.push({
                    timestamp: changeDate,
                    actorName: adminEmail.split('@')[0] || 'Admin',
                    actorEmail: adminEmail,
                    actorRole: 'admin',
                    actorIsAdmin: true,
                    action: `Alterou estado para ${change.status || '-'}`,
                    details: `${data.userEmail || '-'} - ${data.courtId || 'Campo'} em ${data.datetime || '-'}`
                });
            });
        });
    } catch (error) {
        console.error('Erro ao gerar logs históricos de reservas:', error);
    }

    try {
        const blockedSnap = await getDocs(query(collection(db, 'blockedSlots'), limit(300)));
        blockedSnap.forEach(docSnap => {
            const data = docSnap.data();
            const createdAt = toDateSafe(data.createdAt);
            if (!createdAt) return;

            const adminEmail = data.blockedBy || 'admin';
            legacy.push({
                timestamp: createdAt,
                actorName: adminEmail.split('@')[0] || 'Admin',
                actorEmail: adminEmail,
                actorRole: 'admin',
                actorIsAdmin: true,
                action: 'Bloqueou horário',
                details: `${data.courtId || 'Campo'} em ${data.datetime || (data.date + 'T' + data.time)}`
            });
        });
    } catch (error) {
        console.error('Erro ao gerar logs históricos de bloqueios:', error);
    }

    return legacy;
}

function mergePricingSettings(data = {}) {
    const courts = data.courts || {};
    return {
        courts: {
            'Campo 1': Number(courts['Campo 1']) || DEFAULT_PRICING.courts['Campo 1'],
            'Campo 2': Number(courts['Campo 2']) || DEFAULT_PRICING.courts['Campo 2'],
            'Campo 3': Number(courts['Campo 3']) || DEFAULT_PRICING.courts['Campo 3']
        },
        eveningStartHour: Number.isFinite(Number(data.eveningStartHour)) ? Number(data.eveningStartHour) : DEFAULT_PRICING.eveningStartHour,
        eveningSurcharge: Number.isFinite(Number(data.eveningSurcharge)) ? Number(data.eveningSurcharge) : DEFAULT_PRICING.eveningSurcharge
    };
}

function getCurrentPricingFromForm() {
    return {
        courts: {
            'Campo 1': Number(document.getElementById('price-campo-1')?.value) || 0,
            'Campo 2': Number(document.getElementById('price-campo-2')?.value) || 0,
            'Campo 3': Number(document.getElementById('price-campo-3')?.value) || 0
        },
        eveningStartHour: Number(document.getElementById('pricing-evening-start')?.value),
        eveningSurcharge: Number(document.getElementById('pricing-evening-surcharge')?.value) || 0
    };
}

function fillPricingForm(settings) {
    const field1 = document.getElementById('price-campo-1');
    const field2 = document.getElementById('price-campo-2');
    const field3 = document.getElementById('price-campo-3');
    const eveningStart = document.getElementById('pricing-evening-start');
    const eveningSurcharge = document.getElementById('pricing-evening-surcharge');

    if (field1) field1.value = settings.courts['Campo 1'];
    if (field2) field2.value = settings.courts['Campo 2'];
    if (field3) field3.value = settings.courts['Campo 3'];
    if (eveningStart) eveningStart.value = settings.eveningStartHour;
    if (eveningSurcharge) eveningSurcharge.value = settings.eveningSurcharge;

    updatePricingPreview();
}

function computePrice(settings, court, time) {
    const hour = Number((time || '00:00').split(':')[0]);
    const base = Number(settings.courts[court] || 0);
    const surcharge = hour >= Number(settings.eveningStartHour) ? Number(settings.eveningSurcharge || 0) : 0;
    return base + surcharge;
}

function updatePricingPreview() {
    const settings = getCurrentPricingFromForm();
    const normalEl = document.getElementById('preview-price-normal');
    const peakEl = document.getElementById('preview-price-peak');
    const court3El = document.getElementById('preview-price-court3');

    if (normalEl) normalEl.textContent = `${computePrice(settings, 'Campo 1', '17:00')}EUR`;
    if (peakEl) peakEl.textContent = `${computePrice(settings, 'Campo 1', '18:00')}EUR`;
    if (court3El) court3El.textContent = `${computePrice(settings, 'Campo 3', '18:00')}EUR`;
}

function updatePricingBadge(updatedAt) {
    const badge = document.getElementById('pricing-last-updated');
    if (!badge) return;

    if (!updatedAt) {
        badge.textContent = 'Sem alterações ainda';
        return;
    }

    const dateObj = updatedAt?.toDate?.() || new Date(updatedAt);
    badge.textContent = `Atualizado em ${dateObj.toLocaleDateString('pt-PT')} ${dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}`;
}

function listenPricingSettings() {
    const pricingRef = doc(db, 'settings', 'pricing');

    onSnapshot(pricingRef, async (snapshot) => {
        if (!snapshot.exists()) {
            const adminEmail = auth.currentUser?.email || 'admin';
            await setDoc(pricingRef, {
                ...DEFAULT_PRICING,
                updatedAt: serverTimestamp(),
                updatedBy: adminEmail
            }, { merge: true });
            return;
        }

        const data = snapshot.data();
        pricingSettings = mergePricingSettings(data);
        fillPricingForm(pricingSettings);
        updatePricingBadge(data.updatedAt);
    }, (error) => {
        console.error('Erro ao carregar preços:', error);
    });
}

window.savePricingSettings = async () => {
    try {
        const nextSettings = getCurrentPricingFromForm();

        if (nextSettings.eveningStartHour < 0 || nextSettings.eveningStartHour > 23) {
            Swal.fire('Validação', 'A hora de início do horário de ponta deve estar entre 0 e 23.', 'warning');
            return;
        }

        if (Object.values(nextSettings.courts).some(v => v < 0) || nextSettings.eveningSurcharge < 0) {
            Swal.fire('Validação', 'Os preços não podem ser negativos.', 'warning');
            return;
        }

        const adminEmail = auth.currentUser?.email || 'admin';
        await setDoc(doc(db, 'settings', 'pricing'), {
            ...nextSettings,
            updatedAt: serverTimestamp(),
            updatedBy: adminEmail
        }, { merge: true });

        await logActivity(
            'Atualizou preços',
            `C1=${nextSettings.courts['Campo 1']}EUR, C2=${nextSettings.courts['Campo 2']}EUR, C3=${nextSettings.courts['Campo 3']}EUR, pico=${nextSettings.eveningSurcharge}EUR a partir das ${nextSettings.eveningStartHour}h`,
            { targetType: 'pricing', targetId: 'settings/pricing' }
        );

        Swal.fire('Guardado!', 'Os preços foram atualizados com sucesso.', 'success');
    } catch (error) {
        console.error('Erro ao guardar preços:', error);
        Swal.fire('Erro', 'Não foi possível guardar os preços.', 'error');
    }
};

window.resetPricingDefaults = () => {
    pricingSettings = { ...DEFAULT_PRICING, courts: { ...DEFAULT_PRICING.courts } };
    fillPricingForm(pricingSettings);
};

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
                    loadNotAdmittedBookings();
                    checkAndMarkNotAdmitted();
                    loadEvaluations();
                    loadPayments();
                    loadActivityLogs();
                    initCalendar();
                    setupExportButtons();
                    setupBillingReports();
                    listenPricingSettings();
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
let allStatisticsBookings = [];
let billingReportState = {
    type: 'week',
    label: '-',
    rows: [],
    totalRevenue: 0
};
let billingReportInitialized = false;

function loadStatistics() {
    const q = query(collection(db, "reservas"));
    
    onSnapshot(q, (snapshot) => {
        allStatisticsBookings = snapshot.docs
            .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
            .filter(booking => booking.datetime);

        applyStatisticsFilter();
        refreshBillingReportPreview(false);
    });
}

function getDateRangeByPeriod(period, customFrom, customTo) {
    const now = new Date();

    if (period === 'all') return { start: null, end: null, label: 'Tudo' };

    if (period === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'Hoje' };
    }

    if (period === 'week') {
        const day = now.getDay();
        const diffToMonday = day === 0 ? 6 : day - 1;
        const start = new Date(now);
        start.setDate(now.getDate() - diffToMonday);
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        end.setHours(23, 59, 59, 999);
        return { start, end, label: 'Esta Semana' };
    }

    if (period === 'month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        return { start, end, label: 'Este Mês' };
    }

    if (period === 'custom') {
        if (!customFrom || !customTo) {
            return null;
        }

        const start = new Date(customFrom + 'T00:00:00');
        const end = new Date(customTo + 'T23:59:59');
        return { start, end, label: `${customFrom} até ${customTo}` };
    }

    return { start: null, end: null, label: 'Tudo' };
}

function applyStatisticsFilter() {
    const periodSelect = document.getElementById('stats-period');
    const fromInput = document.getElementById('stats-date-from');
    const toInput = document.getElementById('stats-date-to');
    const labelEl = document.getElementById('stats-filter-label');
    const periodBookingsEl = document.getElementById('stat-period-bookings');
    const periodRevenueEl = document.getElementById('stat-period-revenue');

    const period = periodSelect?.value || 'all';
    const dateRange = getDateRangeByPeriod(period, fromInput?.value, toInput?.value);

    if (period === 'custom' && !dateRange) {
        if (labelEl) labelEl.textContent = 'Período: seleciona as duas datas.';
        return;
    }

    let filteredBookings = [...allStatisticsBookings];

    if (dateRange?.start && dateRange?.end) {
        filteredBookings = filteredBookings.filter(booking => {
            const dateObj = new Date(booking.datetime);
            return dateObj >= dateRange.start && dateObj <= dateRange.end;
        });
    }

    let approved = 0;
    let pending = 0;
    let rejected = 0;
    let revenue = 0;
    const revenueByDay = {};
    const bookingCountByDay = {};
    const courtUsage = {};

    filteredBookings.forEach(booking => {
        const status = booking.status;
        const court = booking.courtId || 'Desconhecido';
        const bookingDate = new Date(booking.datetime);
        const dayKey = bookingDate.toISOString().split('T')[0];

        if (!bookingCountByDay[dayKey]) bookingCountByDay[dayKey] = 0;
        bookingCountByDay[dayKey]++;

        if (!courtUsage[court]) courtUsage[court] = 0;
        courtUsage[court]++;

        if (status === 'Aprovado') {
            approved++;
            const price = Number(booking.price || 0);
            revenue += price;

            if (!revenueByDay[dayKey]) revenueByDay[dayKey] = 0;
            revenueByDay[dayKey] += price;
        } else if (status === 'Pendente') {
            pending++;
        } else if (status === 'Recusado') {
            rejected++;
        }
    });

    const sortedDays = Object.keys(bookingCountByDay).sort();
    const labels = sortedDays.map(day => {
        const [year, month, date] = day.split('-');
        return new Date(Number(year), Number(month) - 1, Number(date)).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' });
    });
    const revenueValues = sortedDays.map(day => revenueByDay[day] || 0);
    const bookingCountValues = sortedDays.map(day => bookingCountByDay[day] || 0);

    const statApproved = document.getElementById('stat-approved');
    const statPending = document.getElementById('stat-pending');
    const statRejected = document.getElementById('stat-rejected');
    const statRevenue = document.getElementById('stat-revenue');

    if (statApproved) statApproved.textContent = approved;
    if (statPending) statPending.textContent = pending;
    if (statRejected) statRejected.textContent = rejected;
    if (statRevenue) statRevenue.textContent = revenue + '€';

    if (periodBookingsEl) periodBookingsEl.textContent = filteredBookings.length;
    if (periodRevenueEl) periodRevenueEl.textContent = revenue + 'EUR';
    if (labelEl) labelEl.textContent = `Período: ${dateRange?.label || 'Tudo'}`;

    updateCharts(labels, revenueValues, bookingCountValues, courtUsage);
}

function getISOWeekNumber(date) {
    const currentDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = currentDate.getUTCDay() || 7;
    currentDate.setUTCDate(currentDate.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(currentDate.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((currentDate - yearStart) / 86400000) + 1) / 7);
    return weekNo;
}

function getWeekInputValue(date = new Date()) {
    const week = String(getISOWeekNumber(date)).padStart(2, '0');
    return `${date.getFullYear()}-W${week}`;
}

function getDateRangeFromWeekValue(weekValue) {
    if (!weekValue || !weekValue.includes('-W')) return null;

    const [yearStr, weekStr] = weekValue.split('-W');
    const year = Number(yearStr);
    const week = Number(weekStr);
    if (!Number.isFinite(year) || !Number.isFinite(week)) return null;

    const jan4 = new Date(year, 0, 4);
    const jan4Day = jan4.getDay() || 7;
    const mondayWeek1 = new Date(jan4);
    mondayWeek1.setDate(jan4.getDate() - jan4Day + 1);

    const start = new Date(mondayWeek1);
    start.setDate(mondayWeek1.getDate() + (week - 1) * 7);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { start, end };
}

function getDateRangeFromMonthValue(monthValue) {
    if (!monthValue || !monthValue.includes('-')) return null;

    const [yearStr, monthStr] = monthValue.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;

    const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start, end };
}

function formatEur(value) {
    return `${Number(value || 0).toFixed(2)}EUR`;
}

function generateBillingReportData(type, start, end, label) {
    const approvedBookings = allStatisticsBookings
        .filter(booking => booking.status === 'Aprovado')
        .filter(booking => {
            const dt = new Date(booking.datetime);
            return dt >= start && dt <= end;
        })
        .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

    const rows = approvedBookings.map(booking => {
        const dt = new Date(booking.datetime);
        const value = Number(booking.price || 0);
        return {
            date: dt.toLocaleDateString('pt-PT'),
            time: dt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }),
            courtId: booking.courtId || 'Campo',
            userEmail: booking.userEmail || '-',
            paymentMethod: booking.paymentMethod || '-',
            value
        };
    });

    const totalRevenue = rows.reduce((sum, row) => sum + row.value, 0);

    return {
        type,
        label,
        start,
        end,
        rows,
        totalRevenue
    };
}

function formatDateForFileName(date) {
    const dt = new Date(date);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function getBillingReportPeriodSuffix() {
    const start = billingReportState.start;
    const end = billingReportState.end;

    if (!start || !end) return 'periodo';

    return `${formatDateForFileName(start)}-ate-${formatDateForFileName(end)}`;
}

function renderBillingReportPreview(report) {
    const periodEl = document.getElementById('billing-preview-period');
    const bookingsEl = document.getElementById('billing-preview-bookings');
    const totalEl = document.getElementById('billing-preview-total');
    const listEl = document.getElementById('billing-preview-list');

    if (periodEl) periodEl.textContent = report.label;
    if (bookingsEl) bookingsEl.textContent = report.rows.length;
    if (totalEl) totalEl.textContent = formatEur(report.totalRevenue);

    if (!listEl) return;

    if (report.rows.length === 0) {
        listEl.innerHTML = '<tr><td colspan="6" class="text-center text-secondary py-4">Sem reservas aprovadas no período selecionado.</td></tr>';
        return;
    }

    listEl.innerHTML = report.rows.map(row => `
        <tr>
            <td class="p-3 text-secondary">${row.date}</td>
            <td class="p-3 text-white">${row.time}</td>
            <td class="p-3 text-white">${row.courtId}</td>
            <td class="p-3 text-secondary">${row.userEmail}</td>
            <td class="p-3 text-secondary">${row.paymentMethod}</td>
            <td class="p-3 text-padel fw-bold">${Number(row.value).toFixed(2)}EUR</td>
        </tr>
    `).join('');
}

function refreshBillingReportPreview(showValidationFeedback = true) {
    const typeSelect = document.getElementById('billing-report-type');
    const weekInput = document.getElementById('billing-week-picker');
    const monthInput = document.getElementById('billing-month-picker');

    if (!typeSelect || !weekInput || !monthInput) return;

    const type = typeSelect.value || 'week';
    let dateRange = null;
    let label = '-';

    if (type === 'week') {
        dateRange = getDateRangeFromWeekValue(weekInput.value);
        if (!dateRange) {
            if (showValidationFeedback) Swal.fire('Validação', 'Seleciona uma semana válida.', 'warning');
            return;
        }
        label = `Semana ${weekInput.value}`;
    } else {
        dateRange = getDateRangeFromMonthValue(monthInput.value);
        if (!dateRange) {
            if (showValidationFeedback) Swal.fire('Validação', 'Seleciona um mês válido.', 'warning');
            return;
        }
        label = new Date(dateRange.start).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
    }

    billingReportState = generateBillingReportData(type, dateRange.start, dateRange.end, label);
    renderBillingReportPreview(billingReportState);
}

function downloadBillingReportCSV() {
    if (!billingReportState.rows.length) {
        if (window.Notification) {
            window.Notification.warning('Aviso', 'Não existem dados para exportar no período selecionado.', 3000);
        }
        return;
    }

    const exportRows = billingReportState.rows.map(row => ({
        'Periodo': billingReportState.label,
        'Data': row.date,
        'Hora': row.time,
        'Campo': row.courtId,
        'Email Utilizador': row.userEmail,
        'Metodo Pagamento': row.paymentMethod,
        'Valor': Number(row.value).toFixed(2) + 'EUR'
    }));

    const periodSuffix = getBillingReportPeriodSuffix();

    const filename = `relatorio-faturacao-${billingReportState.type === 'week' ? 'semanal' : 'mensal'}-${periodSuffix}.csv`;
    window.ExportSystem.exportToCSV(exportRows, filename);

    if (window.Notification) {
        window.Notification.success('✅ Exportado', `Ficheiro ${filename} descarregado com sucesso!`, 3000);
    }
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function buildBillingReportPDFHtml() {
    const today = new Date();
    const generatedAt = today.toLocaleDateString('pt-PT') + ' ' + today.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const adminEmail = auth.currentUser?.email || 'admin@exemplo.com';
    const reportRef = `RFT-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-${String(today.getHours()).padStart(2, '0')}${String(today.getMinutes()).padStart(2, '0')}`;

    const companyInfo = billingCompanyProfile;

    const rowsHtml = billingReportState.rows.map((row, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(row.time)}</td>
            <td>${escapeHtml(row.courtId)}</td>
            <td>${escapeHtml(row.userEmail)}</td>
            <td>${escapeHtml(row.paymentMethod)}</td>
            <td style="text-align:right; font-weight:700;">${Number(row.value).toFixed(2)} EUR</td>
        </tr>
    `).join('');

    return `
        <div style="font-family: Arial, Helvetica, sans-serif; color:#0f172a;">
            <div style="border:1px solid #cbd5e1; border-radius:12px; overflow:hidden;">
                <div style="background:linear-gradient(90deg,#0f172a,#1e293b); color:#ffffff; padding:20px 24px;">
                    <div style="font-size:24px; font-weight:800; letter-spacing:0.3px;">SMASHLAB PADEL CLUB</div>
                    <div style="font-size:12px; opacity:0.9; margin-top:4px;">Relatório Oficial de Faturação</div>
                </div>

                <div style="padding:14px 24px; background:#ffffff; border-bottom:1px solid #e2e8f0;">
                    <table style="width:100%; border-collapse:collapse; font-size:11px; color:#334155;">
                        <tr>
                            <td style="padding:2px 0;"><strong>Entidade:</strong> ${escapeHtml(companyInfo.legalName)}</td>
                            <td style="padding:2px 0; text-align:right;"><strong>${escapeHtml(companyInfo.taxId)}</strong></td>
                        </tr>
                        <tr>
                            <td style="padding:2px 0;">${escapeHtml(companyInfo.address)}</td>
                            <td style="padding:2px 0; text-align:right;">${escapeHtml(companyInfo.website)}</td>
                        </tr>
                        <tr>
                            <td style="padding:2px 0;">${escapeHtml(companyInfo.email)}</td>
                            <td style="padding:2px 0; text-align:right;">${escapeHtml(companyInfo.phone)}</td>
                        </tr>
                    </table>
                </div>

                <div style="padding:20px 24px; background:#f8fafc; border-bottom:1px solid #e2e8f0;">
                    <table style="width:100%; border-collapse:collapse; font-size:12px;">
                        <tr>
                            <td style="padding:4px 0; color:#334155;"><strong>Período:</strong> ${escapeHtml(billingReportState.label)}</td>
                            <td style="padding:4px 0; color:#334155; text-align:right;"><strong>Emitido em:</strong> ${generatedAt}</td>
                        </tr>
                        <tr>
                            <td style="padding:4px 0; color:#334155;"><strong>Preparado por:</strong> ${escapeHtml(adminEmail)}</td>
                            <td style="padding:4px 0; color:#334155; text-align:right;"><strong>Tipo:</strong> ${billingReportState.type === 'week' ? 'Semanal' : 'Mensal'}</td>
                        </tr>
                        <tr>
                            <td style="padding:4px 0; color:#334155;"><strong>Referência:</strong> ${escapeHtml(reportRef)}</td>
                            <td style="padding:4px 0; color:#334155; text-align:right;"><strong>Moeda:</strong> EUR</td>
                        </tr>
                    </table>
                </div>

                <div style="padding:16px 24px;">
                    <div style="display:flex; gap:12px; margin-bottom:16px;">
                        <div style="flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#ffffff;">
                            <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.4px;">Total Reservas</div>
                            <div style="font-size:22px; font-weight:800; color:#0f172a; margin-top:6px;">${billingReportState.rows.length}</div>
                        </div>
                        <div style="flex:1; border:1px solid #e2e8f0; border-radius:8px; padding:12px; background:#ffffff;">
                            <div style="font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.4px;">Faturação Total</div>
                            <div style="font-size:22px; font-weight:800; color:#0f766e; margin-top:6px;">${Number(billingReportState.totalRevenue).toFixed(2)} EUR</div>
                        </div>
                    </div>

                    <table style="width:100%; border-collapse:collapse; font-size:11px;">
                        <thead>
                            <tr style="background:#e2e8f0; color:#0f172a;">
                                <th style="padding:8px; border:1px solid #cbd5e1;">#</th>
                                <th style="padding:8px; border:1px solid #cbd5e1;">Data</th>
                                <th style="padding:8px; border:1px solid #cbd5e1;">Hora</th>
                                <th style="padding:8px; border:1px solid #cbd5e1;">Campo</th>
                                <th style="padding:8px; border:1px solid #cbd5e1;">Utilizador</th>
                                <th style="padding:8px; border:1px solid #cbd5e1;">Pagamento</th>
                                <th style="padding:8px; border:1px solid #cbd5e1; text-align:right;">Valor</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>

                <div style="padding:10px 24px; border-top:1px solid #e2e8f0; background:#f8fafc; font-size:10px; color:#64748b; display:flex; justify-content:space-between; gap:12px;">
                    <span>Documento gerado automaticamente pelo sistema administrativo SmashLab.</span>
                    <span>${escapeHtml(companyInfo.legalName)} | ${escapeHtml(companyInfo.taxId)}</span>
                </div>
            </div>
        </div>
    `;
}

function getBillingCompanyProfileFromForm() {
    return {
        legalName: document.getElementById('billing-company-legal-name')?.value?.trim() || BILLING_COMPANY_PROFILE.legalName,
        taxId: document.getElementById('billing-company-tax-id')?.value?.trim() || BILLING_COMPANY_PROFILE.taxId,
        address: document.getElementById('billing-company-address')?.value?.trim() || BILLING_COMPANY_PROFILE.address,
        phone: document.getElementById('billing-company-phone')?.value?.trim() || BILLING_COMPANY_PROFILE.phone,
        email: document.getElementById('billing-company-email')?.value?.trim() || BILLING_COMPANY_PROFILE.email,
        website: document.getElementById('billing-company-website')?.value?.trim() || BILLING_COMPANY_PROFILE.website
    };
}

function fillBillingCompanyProfileForm(profile) {
    const nameEl = document.getElementById('billing-company-legal-name');
    const taxEl = document.getElementById('billing-company-tax-id');
    const addressEl = document.getElementById('billing-company-address');
    const phoneEl = document.getElementById('billing-company-phone');
    const emailEl = document.getElementById('billing-company-email');
    const websiteEl = document.getElementById('billing-company-website');

    if (nameEl) nameEl.value = profile.legalName || '';
    if (taxEl) taxEl.value = profile.taxId || '';
    if (addressEl) addressEl.value = profile.address || '';
    if (phoneEl) phoneEl.value = profile.phone || '';
    if (emailEl) emailEl.value = profile.email || '';
    if (websiteEl) websiteEl.value = profile.website || '';
}

async function loadBillingCompanyProfile() {
    try {
        const profileRef = doc(db, 'settings', 'billingCompanyProfile');
        const profileSnap = await getDoc(profileRef);

        if (profileSnap.exists()) {
            billingCompanyProfile = {
                ...BILLING_COMPANY_PROFILE,
                ...profileSnap.data()
            };
        } else {
            billingCompanyProfile = { ...BILLING_COMPANY_PROFILE };
        }

        fillBillingCompanyProfileForm(billingCompanyProfile);
    } catch (error) {
        console.error('Erro ao carregar perfil da empresa para faturação:', error);
        billingCompanyProfile = { ...BILLING_COMPANY_PROFILE };
        fillBillingCompanyProfileForm(billingCompanyProfile);
    }
}

async function saveBillingCompanyProfile() {
    try {
        const nextProfile = getBillingCompanyProfileFromForm();
        const adminEmail = auth.currentUser?.email || 'admin';

        await setDoc(doc(db, 'settings', 'billingCompanyProfile'), {
            ...nextProfile,
            updatedBy: adminEmail,
            updatedAt: serverTimestamp()
        }, { merge: true });

        billingCompanyProfile = { ...nextProfile };

        await logActivity(
            'Atualizou dados institucionais de faturação',
            `Entidade: ${nextProfile.legalName}`,
            { targetType: 'billingCompanyProfile', targetId: 'settings/billingCompanyProfile' }
        );

        Swal.fire('Guardado!', 'Os dados da empresa para o PDF foram atualizados.', 'success');
    } catch (error) {
        console.error('Erro ao guardar perfil da empresa para faturação:', error);
        Swal.fire('Erro', 'Não foi possível guardar os dados da empresa.', 'error');
    }
}

async function downloadBillingReportPDF() {
    if (!billingReportState.rows.length) {
        if (window.Notification) {
            window.Notification.warning('Aviso', 'Não existem dados para exportar no período selecionado.', 3000);
        }
        return;
    }

    const periodSuffix = getBillingReportPeriodSuffix();

    const filename = `relatorio-faturacao-${billingReportState.type === 'week' ? 'semanal' : 'mensal'}-${periodSuffix}.pdf`;

    try {
        await window.ExportSystem.exportToPDF(buildBillingReportPDFHtml(), filename);
        if (window.Notification) {
            window.Notification.success('✅ Exportado', `Ficheiro ${filename} descarregado com sucesso!`, 3000);
        }
    } catch (error) {
        console.error('Erro ao exportar PDF:', error);
        Swal.fire('Erro', 'Não foi possível gerar o PDF.', 'error');
    }
}

function setupBillingReports() {
    if (billingReportInitialized) return;

    const typeSelect = document.getElementById('billing-report-type');
    const weekWrap = document.getElementById('billing-week-wrap');
    const monthWrap = document.getElementById('billing-month-wrap');
    const weekInput = document.getElementById('billing-week-picker');
    const monthInput = document.getElementById('billing-month-picker');
    const btnPreview = document.getElementById('btn-preview-billing-report');
    const btnDownloadCSV = document.getElementById('btn-download-billing-csv');
    const btnDownloadPDF = document.getElementById('btn-download-billing-pdf');
    const btnSaveCompanyProfile = document.getElementById('btn-save-billing-company-profile');

    if (!typeSelect || !weekWrap || !monthWrap || !weekInput || !monthInput) return;

    weekInput.value = getWeekInputValue(new Date());
    monthInput.value = new Date().toISOString().slice(0, 7);

    const toggleTypeFields = () => {
        const isWeekly = typeSelect.value === 'week';
        weekWrap.classList.toggle('d-none', !isWeekly);
        monthWrap.classList.toggle('d-none', isWeekly);
    };

    typeSelect.addEventListener('change', () => {
        toggleTypeFields();
        refreshBillingReportPreview(false);
    });

    weekInput.addEventListener('change', () => {
        if (typeSelect.value === 'week') refreshBillingReportPreview(false);
    });

    monthInput.addEventListener('change', () => {
        if (typeSelect.value === 'month') refreshBillingReportPreview(false);
    });

    if (btnPreview) btnPreview.addEventListener('click', () => refreshBillingReportPreview(true));
    if (btnDownloadCSV) btnDownloadCSV.addEventListener('click', downloadBillingReportCSV);
    if (btnDownloadPDF) btnDownloadPDF.addEventListener('click', downloadBillingReportPDF);
    if (btnSaveCompanyProfile) btnSaveCompanyProfile.addEventListener('click', saveBillingCompanyProfile);

    toggleTypeFields();
    loadBillingCompanyProfile();
    refreshBillingReportPreview(false);
    billingReportInitialized = true;
}

function updateCharts(labels, revenueValues, countValues, courtUsage) {
    // 1. Gráfico de Receita (Barra + Linha)
    const ctxRevenue = document.getElementById('revenueChart');
    if (ctxRevenue) {
        const safeLabels = labels.length > 0 ? labels : ['Sem dados'];
        const safeRevenueValues = revenueValues.length > 0 ? revenueValues : [0];
        const safeCountValues = countValues.length > 0 ? countValues : [0];

        if (revenueChartInstance) {
            revenueChartInstance.destroy();
        }

        revenueChartInstance = new Chart(ctxRevenue, {
            type: 'bar',
            data: {
                labels: safeLabels,
                datasets: [
                    {
                        label: 'Receita (€)',
                        data: safeRevenueValues,
                        backgroundColor: 'rgba(56, 189, 248, 0.5)', // sky-400
                        borderColor: '#38bdf8',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Nº Reservas',
                        data: safeCountValues,
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
        const courts = Object.keys(courtUsage).length > 0 ? Object.keys(courtUsage) : ['Sem dados'];
        const values = Object.values(courtUsage).length > 0 ? Object.values(courtUsage) : [1];

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

            await logActivity(
                'Bloqueou horário',
                `${court} em ${dateVal} às ${time}`,
                { targetType: 'blockedSlot', targetId: `${court}-${finalDateTime}` }
            );

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

    // Guardar snapshots para re-render conjunto
    let reservasSnapshot = null;
    let blockedSnapshot = null;

    function renderCalendarSlots() {
        // Limpar todos os slots
        document.querySelectorAll('.calendar-slot').forEach(slot => {
            slot.innerHTML = '';
        });

        // 1. Renderizar reservas
        if (reservasSnapshot) {
            reservasSnapshot.forEach(docSnap => {
                const data = docSnap.data();
                
                // Ignorar rejeitadas
                if (data.status === 'Rejeitado') return;
                
                const timePart = data.datetime.split('T')[1];
                const court = data.courtId;
                const slotId = `slot-${court.replace(' ', '-')}-${timePart.replace(':', '-')}`;
                const slotEl = document.getElementById(slotId);

                if (slotEl) {
                    const div = document.createElement('div');

                    if (data.status === 'Cancelado') {
                        // Reserva cancelada - aguarda decisão do admin
                        div.className = 'calendar-booking bg-slot-cancelled';
                        div.textContent = `❌ ${data.userEmail} (Cancelado)`;
                        div.title = `Reserva cancelada - Clica para libertar ou bloquear`;
                        div.onclick = (e) => {
                            e.stopPropagation();
                            showCancelledSlotActions(docSnap.id, data);
                        };
                    } else {
                        const badgeClass = 
                            data.status === 'Pendente' ? 'bg-slot-pending' :
                            data.status === 'Não Admitida' ? 'bg-warning text-dark' :
                            'bg-slot-approved';

                        div.className = `calendar-booking ${badgeClass}`;
                        div.textContent = `${data.userEmail} (${data.status})`;
                        div.title = `User: ${data.userEmail}\nStatus: ${data.status}`;
                        div.onclick = (e) => {
                            e.stopPropagation();
                            showBookingDetails(docSnap.id, data);
                        };
                    }
                    
                    slotEl.innerHTML = '';
                    slotEl.appendChild(div);
                }
            });
        }

        // 2. Renderizar slots bloqueados (sobrepõe reservas canceladas se houver bloqueio)
        if (blockedSnapshot) {
            blockedSnapshot.forEach(docSnap => {
                const data = docSnap.data();
                const timePart = data.time;
                const court = data.courtId;
                const slotId = `slot-${court.replace(' ', '-')}-${timePart.replace(':', '-')}`;
                const slotEl = document.getElementById(slotId);

                if (slotEl) {
                    const div = document.createElement('div');
                    
                    if (data.reason === 'Libertado pelo admin') {
                        div.className = 'calendar-booking bg-slot-freed';
                        div.textContent = '✅ Libertado pelo admin';
                        div.title = `Libertado por: ${data.freedBy || 'Admin'}`;
                        div.onclick = (e) => {
                            e.stopPropagation();
                            unblockSlot(docSnap.id, data);
                        };
                    } else {
                        div.className = 'calendar-booking bg-slot-blocked';
                        div.textContent = '🔒 BLOQUEADO';
                        div.title = `Motivo: ${data.reason || 'Manutenção'}`;
                        div.onclick = (e) => {
                            e.stopPropagation();
                            unblockSlot(docSnap.id, data);
                        };
                    }
                    
                    slotEl.innerHTML = '';
                    slotEl.appendChild(div);
                }
            });
        }
    }

    // Listener para reservas
    onSnapshot(qReservas, (snapshot) => {
        reservasSnapshot = snapshot;
        renderCalendarSlots();
    });

    // Listener para slots bloqueados
    onSnapshot(qBlocked, (snapshot) => {
        blockedSnapshot = snapshot;
        renderCalendarSlots();
    });
}

// Ações para slot com reserva cancelada
async function showCancelledSlotActions(docId, data) {
    const timePart = data.datetime.split('T')[1];
    const result = await Swal.fire({
        title: 'Reserva Cancelada',
        html: `
            <p><strong>Campo:</strong> ${data.courtId}</p>
            <p><strong>Hora:</strong> ${timePart}</p>
            <p><strong>Utilizador:</strong> ${data.userEmail}</p>
            <p class="text-muted">O que queres fazer com este horário?</p>
        `,
        icon: 'question',
        showDenyButton: true,
        showCancelButton: true,
        confirmButtonText: '✅ Libertar Horário',
        denyButtonText: '🔒 Bloquear Horário',
        cancelButtonText: 'Fechar',
        confirmButtonColor: '#22c55e',
        denyButtonColor: '#64748b'
    });

    if (result.isConfirmed) {
        // Libertar - marcar reserva como libertada e remover da ocupação
        try {
            const adminEmail = auth.currentUser?.email || 'Admin';
            await updateDoc(doc(db, "reservas", docId), {
                status: 'Libertado',
                freedBy: adminEmail,
                freedAt: new Date()
            });

            await logActivity(
                'Libertou horário cancelado',
                `${data.courtId} em ${data.datetime}`,
                { targetType: 'reserva', targetId: docId }
            );

            Swal.fire('Libertado!', 'O horário está agora disponível para novas reservas.', 'success');
        } catch (error) {
            console.error('Erro ao libertar:', error);
            Swal.fire('Erro', 'Não foi possível libertar o horário.', 'error');
        }
    } else if (result.isDenied) {
        // Bloquear - criar bloqueio e marcar reserva
        try {
            const adminEmail = auth.currentUser?.email || 'Admin';
            const [dateVal, timeVal] = data.datetime.split('T');
            
            await updateDoc(doc(db, "reservas", docId), {
                status: 'Bloqueado',
                blockedBy: adminEmail,
                blockedAt: new Date()
            });

            await addDoc(collection(db, "blockedSlots"), {
                date: dateVal,
                time: timeVal,
                courtId: data.courtId,
                datetime: data.datetime,
                blockedBy: adminEmail,
                reason: 'Bloqueado após cancelamento',
                createdAt: new Date(),
                timestamp: Date.now()
            });

            await logActivity(
                'Bloqueou horário após cancelamento',
                `${data.courtId} em ${data.datetime}`,
                { targetType: 'reserva', targetId: docId }
            );

            Swal.fire('Bloqueado!', 'O horário foi bloqueado.', 'success');
        } catch (error) {
            console.error('Erro ao bloquear:', error);
            Swal.fire('Erro', 'Não foi possível bloquear o horário.', 'error');
        }
    }
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

            await logActivity(
                'Desbloqueou horário',
                `${data.courtId} em ${data.datetime || (data.date + 'T' + data.time)}`,
                { targetType: 'blockedSlot', targetId: slotId }
            );

            Swal.fire('Desbloqueado!', 'O horário foi desbloqueado.', 'success');
            loadCalendarBookings(); // Recarregar
        } catch (error) {
            console.error("Erro ao desbloquear:", error);
            Swal.fire('Erro', 'Não foi possível desbloquear.', 'error');
        }
    }
}

async function showBookingDetails(docId, data) {
    const profile = await getUserProfile(data.userId);
    const displayName = data.userName || profile.name || 'Utilizador';
    const displayEmail = data.userEmail || profile.email || 'Sem email';

    Swal.fire({
        title: 'Detalhes da Reserva',
        html: `
            <p><strong>Campo:</strong> ${data.courtId}</p>
            <p><strong>Hora:</strong> ${data.datetime.split('T')[1]}</p>
            <p><strong>Nome:</strong> ${displayName}</p>
            <p><strong>Email:</strong> ${displayEmail}</p>
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

async function getUserProfile(userId) {
    if (!userId) {
        return { name: '', email: '' };
    }

    if (userProfileCache.has(userId)) {
        return userProfileCache.get(userId);
    }

    try {
        const userSnap = await getDoc(doc(db, 'users', userId));
        if (userSnap.exists()) {
            const data = userSnap.data();
            const profile = {
                name: data.name || '',
                email: data.email || ''
            };
            userProfileCache.set(userId, profile);
            return profile;
        }
    } catch (error) {
        console.error('Erro ao carregar perfil do utilizador:', error);
    }

    const fallback = { name: '', email: '' };
    userProfileCache.set(userId, fallback);
    return fallback;
}

async function enrichBookingsWithUserInfo(bookings) {
    const uniqueUserIds = [...new Set(bookings.map(b => b.userId).filter(Boolean))];
    await Promise.all(uniqueUserIds.map(getUserProfile));

    return bookings.map(booking => {
        const profile = booking.userId ? (userProfileCache.get(booking.userId) || {}) : {};
        const resolvedName = booking.userName || profile.name || '';
        const resolvedEmail = booking.userEmail || profile.email || 'Sem email';

        return {
            ...booking,
            resolvedUserName: resolvedName,
            resolvedUserEmail: resolvedEmail
        };
    });
}

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
async function applyPendingFilters() {
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
    const enriched = await enrichBookingsWithUserInfo(filtered);
    renderPendingBookings(enriched);
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

    const pricingInputs = [
        document.getElementById('price-campo-1'),
        document.getElementById('price-campo-2'),
        document.getElementById('price-campo-3'),
        document.getElementById('pricing-evening-start'),
        document.getElementById('pricing-evening-surcharge')
    ].filter(Boolean);

    pricingInputs.forEach(input => input.addEventListener('input', updatePricingPreview));

    const btnSavePricing = document.getElementById('btn-save-pricing');
    const btnResetPricing = document.getElementById('btn-reset-pricing');

    if (btnSavePricing) btnSavePricing.addEventListener('click', window.savePricingSettings);
    if (btnResetPricing) btnResetPricing.addEventListener('click', window.resetPricingDefaults);

    const statsPeriod = document.getElementById('stats-period');
    const statsCustomRange = document.getElementById('stats-custom-range');
    const statsDateFrom = document.getElementById('stats-date-from');
    const statsDateTo = document.getElementById('stats-date-to');
    const btnApplyStatsFilter = document.getElementById('btn-apply-stats-filter');

    if (statsPeriod) {
        statsPeriod.addEventListener('change', () => {
            const isCustom = statsPeriod.value === 'custom';
            if (statsCustomRange) {
                statsCustomRange.classList.toggle('d-none', !isCustom);
            }

            if (!isCustom) {
                applyStatisticsFilter();
            }
        });
    }

    if (btnApplyStatsFilter) {
        btnApplyStatsFilter.addEventListener('click', applyStatisticsFilter);
    }

    if (statsDateFrom) statsDateFrom.addEventListener('change', () => { if (statsPeriod?.value === 'custom') applyStatisticsFilter(); });
    if (statsDateTo) statsDateTo.addEventListener('change', () => { if (statsPeriod?.value === 'custom') applyStatisticsFilter(); });
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
    const displayName = data.resolvedUserName || 'Utilizador';
    const displayEmail = data.resolvedUserEmail || data.userEmail || 'Sem email';

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
                    <div class="d-flex align-items-center text-white mb-1">
                        <i class="bi bi-person me-2"></i> ${displayName}
                    </div>
                    <div class="d-flex align-items-center text-secondary small">
                        <i class="bi bi-envelope me-2"></i> ${displayEmail}
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

        await logActivity(
            `Alterou estado da reserva para ${newStatus}`,
            `${bookingData.userEmail} - ${bookingData.courtId} em ${bookingData.datetime}`,
            { targetType: 'reserva', targetId: docId }
        );
        
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

            await logActivity(
                decision === 'freed' ? 'Processou cancelamento: libertado' : 'Processou cancelamento: mantido bloqueado',
                `${courtId} em ${datetime}`,
                { targetType: 'cancellation', targetId: notificationId }
            );

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

// --- RESERVAS NÃO ADMITIDAS (Pendentes não tratadas até 1 dia antes) ---

async function checkAndMarkNotAdmitted() {
    try {
        const now = new Date();
        const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const cutoffStr = oneDayFromNow.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm

        const qPendentes = query(
            collection(db, 'reservas'),
            where('status', '==', 'Pendente'),
            where('datetime', '<=', cutoffStr)
        );

        const snapshot = await getDocs(qPendentes);

        const updates = [];
        snapshot.forEach(docSnap => {
            updates.push(updateDoc(doc(db, 'reservas', docSnap.id), {
                status: 'Não Admitida',
                lastModifiedBy: 'sistema',
                lastModifiedAt: new Date(),
                modificationHistory: [
                    ...(docSnap.data().modificationHistory || []),
                    {
                        status: 'Não Admitida',
                        changedBy: 'sistema',
                        changedAt: new Date(),
                        timestamp: new Date().toISOString()
                    }
                ]
            }));
        });

        if (updates.length > 0) {
            await Promise.all(updates);
            console.log(`${updates.length} reserva(s) marcada(s) como 'Não Admitida'.`);

            await logActivity(
                'Marcou reservas como Não Admitida',
                `${updates.length} reserva(s) pendente(s) não tratada(s) a tempo`,
                { targetType: 'reserva', source: 'sistema' }
            );
        }
    } catch (error) {
        console.error('Erro ao verificar reservas não admitidas:', error);
    }
}

function loadNotAdmittedBookings() {
    const notAdmittedList = document.getElementById('not-admitted-list');
    const notAdmittedBadge = document.getElementById('not-admitted-badge');
    const notAdmittedCount = document.getElementById('not-admitted-count');

    if (!notAdmittedList) return;

    const qNotAdmitted = query(
        collection(db, 'reservas'),
        where('status', '==', 'Não Admitida')
    );

    onSnapshot(qNotAdmitted, async (snapshot) => {
        notAdmittedList.innerHTML = '';

        if (snapshot.empty) {
            notAdmittedList.innerHTML = `
                <div class="col-12 text-center text-secondary py-5">
                    <i class="bi bi-check-circle fs-1"></i>
                    <p class="mt-2">Nenhuma reserva não admitida! \uD83C\uDF89</p>
                </div>
            `;
            if (notAdmittedBadge) notAdmittedBadge.style.display = 'none';
            if (notAdmittedCount) notAdmittedCount.textContent = '0';
            return;
        }

        const count = snapshot.size;
        if (notAdmittedBadge) {
            notAdmittedBadge.textContent = count;
            notAdmittedBadge.style.display = 'inline-block';
        }
        if (notAdmittedCount) notAdmittedCount.textContent = count;

        const bookings = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        const enriched = await enrichBookingsWithUserInfo(bookings);

        enriched.forEach(booking => {
            const card = createNotAdmittedCard(booking.id, booking);
            notAdmittedList.appendChild(card);
        });
    });
}

function createNotAdmittedCard(docId, data) {
    const col = document.createElement('div');
    col.className = 'col-lg-6 col-xl-4';

    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const displayName = data.resolvedUserName || data.userName || 'Utilizador';
    const displayEmail = data.resolvedUserEmail || data.userEmail || 'Sem email';

    col.innerHTML = `
        <div class="card card-custom p-4">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <span class="badge bg-dark text-warning border border-warning mb-2">Não Admitida</span>
                    <h5 class="text-white mb-1">${data.courtId || 'Campo'}</h5>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-calendar-event"></i> ${dateStr}
                    </p>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-clock"></i> ${timeStr}
                    </p>
                </div>
                <div class="text-end">
                    <p class="text-padel fs-5 fw-bold mb-0">${Number(data.price || 0)}\u20AC</p>
                </div>
            </div>

            <div class="border-top border-secondary pt-3 mb-3">
                <p class="text-white small mb-1">
                    <i class="bi bi-person-fill"></i> ${displayName}
                </p>
                <p class="text-secondary small mb-0">
                    <i class="bi bi-envelope"></i> ${displayEmail}
                </p>
            </div>

            <div class="alert alert-warning bg-opacity-10 border border-warning p-2 small mb-3">
                <i class="bi bi-exclamation-triangle-fill"></i>
                Esta reserva não foi tratada a tempo e expirou automaticamente.
            </div>

            <div class="d-grid gap-2">
                <button onclick="updateStatus('${docId}', 'Aprovado')" class="btn btn-success btn-sm">
                    <i class="bi bi-check-lg"></i> Aprovar Agora
                </button>
                <button onclick="updateStatus('${docId}', 'Recusado')" class="btn btn-outline-danger btn-sm">
                    <i class="bi bi-x-lg"></i> Recusar
                </button>
            </div>
        </div>
    `;

    return col;
}

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

// ============================================
// SISTEMA DE AVALIAÇÕES
// ============================================

let allEvaluations = [];

async function loadEvaluations() {
    const evalList = document.getElementById('evaluations-list');
    if (!evalList) return;

    // Ler avaliações diretamente das reservas (campo evaluated = true)
    const qEvals = query(
        collection(db, 'reservas'),
        where('evaluated', '==', true)
    );

    onSnapshot(qEvals, (snapshot) => {
        allEvaluations = [];
        const userEmails = new Set();

        snapshot.forEach(docSnap => {
            const data = { id: docSnap.id, ...docSnap.data() };
            allEvaluations.push(data);
            if (data.userEmail) userEmails.add(data.userEmail);
        });

        // Preencher filtro de utilizadores
        const filterUser = document.getElementById('filter-eval-user');
        if (filterUser) {
            const currentVal = filterUser.value;
            filterUser.innerHTML = '<option value="">Todos</option>';
            [...userEmails].sort().forEach(email => {
                filterUser.innerHTML += `<option value="${email}">${email}</option>`;
            });
            filterUser.value = currentVal;
        }

        applyEvaluationFilters();
    }, (error) => {
        console.error('Erro ao carregar avaliações:', error);
        evalList.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Erro: ' + error.message + '</td></tr>';
    });
}

function applyEvaluationFilters() {
    let filtered = [...allEvaluations];

    const userFilter = document.getElementById('filter-eval-user')?.value || '';
    const courtFilter = document.getElementById('filter-eval-court')?.value || '';
    const ratingFilter = document.getElementById('filter-eval-rating')?.value || '';
    const paymentFilter = document.getElementById('filter-eval-payment')?.value || '';

    if (userFilter) filtered = filtered.filter(e => e.userEmail === userFilter);
    if (courtFilter) filtered = filtered.filter(e => e.courtId === courtFilter);
    if (ratingFilter) filtered = filtered.filter(e => e.rating === Number(ratingFilter));
    if (paymentFilter) filtered = filtered.filter(e => e.paymentMethod === paymentFilter);

    // Ordenar por data mais recente
    filtered.sort((a, b) => {
        const da = a.createdAt?.toDate?.() || new Date(a.createdAt);
        const db2 = b.createdAt?.toDate?.() || new Date(b.createdAt);
        return db2 - da;
    });

    renderEvaluations(filtered);
    updateEvaluationStats(filtered);
}

function renderEvaluations(evaluations) {
    const evalList = document.getElementById('evaluations-list');
    const totalCount = document.getElementById('evaluations-total-count');
    if (!evalList) return;

    if (totalCount) totalCount.textContent = `${evaluations.length} avaliações`;

    if (evaluations.length === 0) {
        evalList.innerHTML = '<tr><td colspan="6" class="text-center text-secondary py-4">Nenhuma avaliação encontrada.</td></tr>';
        return;
    }

    evalList.innerHTML = evaluations.map(ev => {
        const bookingDate = new Date(ev.datetime);
        const dateStr = bookingDate.toLocaleDateString('pt-PT') + ' ' + bookingDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

        const evalDate = ev.evaluatedAt?.toDate?.() || (ev.evaluatedAt ? new Date(ev.evaluatedAt) : new Date());
        const evalDateStr = evalDate.toLocaleDateString('pt-PT') + ' ' + evalDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });

        const stars = '⭐'.repeat(ev.rating) + '<span class="text-secondary">' + '☆'.repeat(5 - ev.rating) + '</span>';

        const paymentIcons = {
            'Dinheiro': '<i class="bi bi-cash-stack text-success"></i> Dinheiro',
            'MBway': '<i class="bi bi-phone text-info"></i> MBway',
            'Cartão': '<i class="bi bi-credit-card text-warning"></i> Cartão'
        };
        const paymentDisplay = paymentIcons[ev.paymentMethod] || ev.paymentMethod || '-';

        return `
            <tr>
                <td class="text-white small">${dateStr}</td>
                <td class="text-white">${ev.courtId || '-'}</td>
                <td class="text-secondary">${ev.userEmail || '-'}</td>
                <td>${stars} <span class="text-secondary small">(${ev.rating}/5)</span></td>
                <td>${paymentDisplay}</td>
                <td class="text-secondary small">${evalDateStr}</td>
            </tr>
        `;
    }).join('');
}

function updateEvaluationStats(evaluations) {
    const avgEl = document.getElementById('eval-avg-rating');
    const count5El = document.getElementById('eval-count-5');
    const totalEl = document.getElementById('eval-total-count');
    const topPayEl = document.getElementById('eval-payment-top');

    if (evaluations.length === 0) {
        if (avgEl) avgEl.textContent = '-';
        if (count5El) count5El.textContent = '0';
        if (totalEl) totalEl.textContent = '0';
        if (topPayEl) topPayEl.textContent = '-';
        return;
    }

    const total = evaluations.length;
    const avgRating = (evaluations.reduce((sum, e) => sum + (e.rating || 0), 0) / total).toFixed(1);
    const count5 = evaluations.filter(e => e.rating === 5).length;

    // Método de pagamento mais usado
    const paymentCounts = {};
    evaluations.forEach(e => {
        const m = e.paymentMethod || 'Outro';
        paymentCounts[m] = (paymentCounts[m] || 0) + 1;
    });
    const topPayment = Object.entries(paymentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

    if (avgEl) avgEl.textContent = avgRating + ' ⭐';
    if (count5El) count5El.textContent = count5;
    if (totalEl) totalEl.textContent = total;
    if (topPayEl) topPayEl.textContent = topPayment;
}

// Event listeners para filtros de avaliações
document.addEventListener('DOMContentLoaded', () => {
    const evalFilters = ['filter-eval-user', 'filter-eval-court', 'filter-eval-rating', 'filter-eval-payment'];
    evalFilters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyEvaluationFilters);
    });

    const btnClearEval = document.getElementById('btn-clear-eval-filters');
    if (btnClearEval) {
        btnClearEval.addEventListener('click', () => {
            evalFilters.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            applyEvaluationFilters();
        });
    }

    // Filtros de pagamentos
    const payFilters = ['filter-pay-status', 'filter-pay-method'];
    payFilters.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyPaymentFilters);
    });
});

// ============================================
// SISTEMA DE CONFIRMAÇÃO DE PAGAMENTOS
// ============================================

let allPaymentBookings = [];

function loadPayments() {
    const paymentsList = document.getElementById('payments-list');
    if (!paymentsList) return;

    // Buscar reservas que já foram avaliadas (concluídas)
    const qEvaluated = query(
        collection(db, 'reservas'),
        where('evaluated', '==', true)
    );

    onSnapshot(qEvaluated, async (snapshot) => {
        allPaymentBookings = [];
        snapshot.forEach(docSnap => {
            allPaymentBookings.push({ id: docSnap.id, ...docSnap.data() });
        });

        applyPaymentFilters();
    });
}

function applyPaymentFilters() {
    let filtered = [...allPaymentBookings];

    const statusFilter = document.getElementById('filter-pay-status')?.value || '';
    const methodFilter = document.getElementById('filter-pay-method')?.value || '';

    if (statusFilter === 'pending') {
        filtered = filtered.filter(b => !b.paymentConfirmed && !b.paymentNotPaid);
    } else if (statusFilter === 'confirmed') {
        filtered = filtered.filter(b => b.paymentConfirmed === true);
    } else if (statusFilter === 'notpaid') {
        filtered = filtered.filter(b => b.paymentNotPaid === true);
    }

    if (methodFilter) {
        filtered = filtered.filter(b => b.paymentMethod === methodFilter);
    }

    // Ordenar: por confirmar primeiro, depois por data
    filtered.sort((a, b) => {
        if (!a.paymentConfirmed && b.paymentConfirmed) return -1;
        if (a.paymentConfirmed && !b.paymentConfirmed) return 1;
        return new Date(b.datetime) - new Date(a.datetime);
    });

    renderPayments(filtered);
    updatePaymentBadge();
}

function updatePaymentBadge() {
    const pending = allPaymentBookings.filter(b => !b.paymentConfirmed && !b.paymentNotPaid).length;
    const badge = document.getElementById('payments-badge');
    const countEl = document.getElementById('payments-pending-count');

    if (badge) {
        badge.textContent = pending;
        badge.style.display = pending > 0 ? 'inline-block' : 'none';
    }
    if (countEl) countEl.textContent = pending;
}

function renderPayments(bookings) {
    const paymentsList = document.getElementById('payments-list');
    if (!paymentsList) return;

    paymentsList.innerHTML = '';

    if (bookings.length === 0) {
        paymentsList.innerHTML = `
            <div class="col-12 text-center text-secondary py-5">
                <i class="bi bi-wallet2 fs-1"></i>
                <p class="mt-2">Nenhum pagamento encontrado com esses filtros.</p>
            </div>
        `;
        return;
    }

    bookings.forEach(booking => {
        const card = createPaymentCard(booking.id, booking);
        paymentsList.appendChild(card);
    });
}

function createPaymentCard(docId, data) {
    const col = document.createElement('div');
    col.className = 'col-lg-6 col-xl-4';

    const dateObj = new Date(data.datetime);
    const dateStr = dateObj.toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' });
    const price = Number(data.price || 0);

    const paymentIcons = {
        'Dinheiro': '<i class="bi bi-cash-stack text-success fs-4"></i>',
        'MBway': '<i class="bi bi-phone text-info fs-4"></i>',
        'Cartão': '<i class="bi bi-credit-card text-warning fs-4"></i>'
    };
    const payIcon = paymentIcons[data.paymentMethod] || '<i class="bi bi-question-circle fs-4"></i>';

    const isConfirmed = data.paymentConfirmed === true;
    const isNotPaid = data.paymentNotPaid === true;
    const confirmedAt = data.paymentConfirmedAt?.toDate?.() || (data.paymentConfirmedAt ? new Date(data.paymentConfirmedAt) : null);
    const confirmedStr = confirmedAt ? confirmedAt.toLocaleDateString('pt-PT') + ' ' + confirmedAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '';
    const notPaidAt = data.paymentNotPaidAt?.toDate?.() || (data.paymentNotPaidAt ? new Date(data.paymentNotPaidAt) : null);
    const notPaidStr = notPaidAt ? notPaidAt.toLocaleDateString('pt-PT') + ' ' + notPaidAt.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' }) : '';

    let statusSection;
    if (isConfirmed) {
        statusSection = `<div class="alert alert-success bg-opacity-10 border border-success p-2 small mb-0">
               <i class="bi bi-check-circle-fill"></i> Pagamento confirmado por <strong>${data.paymentConfirmedBy || 'Admin'}</strong>
               <br><small class="text-secondary">${confirmedStr}</small>
           </div>`;
    } else if (isNotPaid) {
        statusSection = `<div class="alert alert-danger bg-opacity-10 border border-danger p-2 small mb-0">
               <i class="bi bi-x-circle-fill"></i> Marcado como <strong>Não Pagou</strong> por <strong>${data.paymentNotPaidBy || 'Admin'}</strong>
               <br><small class="text-secondary">${notPaidStr}</small>
           </div>`;
    } else {
        statusSection = `<div class="d-flex gap-2">
               <button onclick="confirmPayment('${docId}')" class="btn btn-success flex-fill">
                   <i class="bi bi-check-circle"></i> Confirmar Pagamento
               </button>
               <button onclick="markNotPaid('${docId}')" class="btn btn-danger flex-fill">
                   <i class="bi bi-x-circle"></i> Não Pagou
               </button>
           </div>`;
    }

    const stars = data.rating ? '⭐'.repeat(data.rating) : '-';

    col.innerHTML = `
        <div class="card card-custom p-4 ${isConfirmed || isNotPaid ? 'opacity-75' : ''}">
            <div class="d-flex justify-content-between align-items-start mb-3">
                <div>
                    <span class="badge ${isConfirmed ? 'bg-success' : isNotPaid ? 'bg-danger' : 'bg-warning text-dark'} mb-2">
                        ${isConfirmed ? 'Pago ✓' : isNotPaid ? 'Não Pagou ✗' : 'Por confirmar'}
                    </span>
                    <h5 class="text-white mb-1">${data.courtId || 'Campo'}</h5>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-calendar-event"></i> ${dateStr}
                    </p>
                    <p class="text-secondary small mb-0">
                        <i class="bi bi-clock"></i> ${timeStr}
                    </p>
                </div>
                <div class="text-end">
                    <p class="text-padel fs-4 fw-bold mb-1">${price}€</p>
                    <div>${payIcon} <small class="text-white">${data.paymentMethod || '-'}</small></div>
                </div>
            </div>

            <div class="border-top border-secondary pt-3 mb-3">
                <p class="text-white small mb-1">
                    <i class="bi bi-person-fill"></i> ${data.userName || data.userEmail || '-'}
                </p>
                <p class="text-secondary small mb-0">
                    <i class="bi bi-envelope"></i> ${data.userEmail || '-'}
                </p>
                <p class="text-secondary small mb-0">
                    <i class="bi bi-star-fill text-warning"></i> ${stars}
                </p>
            </div>

            ${statusSection}
        </div>
    `;

    return col;
}

// Função Global para confirmar pagamento
window.confirmPayment = async (docId) => {
    const result = await Swal.fire({
        title: 'Confirmar Pagamento?',
        text: 'Confirmas que recebeste o pagamento desta reserva?',
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#22c55e',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, confirmar',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const adminEmail = auth.currentUser?.email || 'Admin';

            await updateDoc(doc(db, 'reservas', docId), {
                paymentConfirmed: true,
                paymentConfirmedBy: adminEmail,
                paymentConfirmedAt: new Date()
            });

            const bookingSnap = await getDoc(doc(db, 'reservas', docId));
            const bookingData = bookingSnap.data();

            await logActivity(
                'Confirmou pagamento',
                `${bookingData.userEmail} - ${bookingData.courtId} em ${bookingData.datetime} (${bookingData.price}€, ${bookingData.paymentMethod})`,
                { targetType: 'payment', targetId: docId }
            );

            Swal.fire({
                title: 'Confirmado!',
                text: 'Pagamento registado com sucesso.',
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });
        } catch (error) {
            console.error('Erro ao confirmar pagamento:', error);
            Swal.fire('Erro', 'Não foi possível confirmar o pagamento.', 'error');
        }
    }
};

// Função Global para marcar como não pagou
window.markNotPaid = async (docId) => {
    const result = await Swal.fire({
        title: 'Marcar como Não Pagou?',
        text: 'Confirmas que este cliente não efetuou o pagamento?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#dc3545',
        cancelButtonColor: '#334155',
        confirmButtonText: 'Sim, não pagou',
        cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
        try {
            const adminEmail = auth.currentUser?.email || 'Admin';

            await updateDoc(doc(db, 'reservas', docId), {
                paymentNotPaid: true,
                paymentNotPaidBy: adminEmail,
                paymentNotPaidAt: new Date(),
                paymentConfirmed: false
            });

            const bookingSnap = await getDoc(doc(db, 'reservas', docId));
            const bookingData = bookingSnap.data();

            await logActivity(
                'Marcou como não pagou',
                `${bookingData.userEmail} - ${bookingData.courtId} em ${bookingData.datetime} (${bookingData.price}€, ${bookingData.paymentMethod})`,
                { targetType: 'payment', targetId: docId }
            );

            Swal.fire({
                title: 'Registado!',
                text: 'Cliente marcado como não pagou.',
                icon: 'info',
                timer: 2000,
                showConfirmButton: false
            });
        } catch (error) {
            console.error('Erro ao marcar como não pagou:', error);
            Swal.fire('Erro', 'Não foi possível registar.', 'error');
        }
    }
};
