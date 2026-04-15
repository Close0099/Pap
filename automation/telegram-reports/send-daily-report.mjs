import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const FIREBASE_PROJECT_ID = String(process.env.FIREBASE_PROJECT_ID || '').trim();
const FIREBASE_CLIENT_EMAIL = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
const FIREBASE_PRIVATE_KEY = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const REPORT_TIMEZONE = String(process.env.REPORT_TIMEZONE || 'Europe/Lisbon').trim();
const REPORT_HOURS = String(process.env.REPORT_HOURS || '9,13').trim();

function requireEnv(name, value) {
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
}

requireEnv('FIREBASE_PROJECT_ID', FIREBASE_PROJECT_ID);
requireEnv('FIREBASE_CLIENT_EMAIL', FIREBASE_CLIENT_EMAIL);
requireEnv('FIREBASE_PRIVATE_KEY', FIREBASE_PRIVATE_KEY);
requireEnv('TELEGRAM_BOT_TOKEN', TELEGRAM_BOT_TOKEN);
requireEnv('TELEGRAM_CHAT_ID', TELEGRAM_CHAT_ID);

initializeApp({
  credential: cert({
    projectId: FIREBASE_PROJECT_ID,
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY
  })
});

const db = getFirestore();

function getLocalDateHour(timeZone) {
  const now = new Date();
  const dateKey = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).format(now));

  return { dateKey, hour };
}

function parseHours(raw) {
  return [...new Set(
    raw.split(',')
      .map((h) => Number(String(h).trim()))
      .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23)
  )];
}

async function getReservationsByDate(dateKey) {
  const start = `${dateKey}T00:00:00`;
  const end = `${dateKey}T23:59:59`;

  const snap = await db
    .collection('reservas')
    .where('datetime', '>=', start)
    .where('datetime', '<=', end)
    .get();

  const rows = [];
  snap.forEach((docSnap) => {
    rows.push({ id: docSnap.id, ...docSnap.data() });
  });

  rows.sort((a, b) => String(a.datetime || '').localeCompare(String(b.datetime || '')));
  return rows;
}

function formatReservation(r) {
  const dt = String(r.datetime || '-');
  const [date, t] = dt.split('T');
  const time = (t || '-').slice(0, 5);
  const court = String(r.courtId || '-');
  const status = String(r.status || 'Pendente');
  const email = String(r.userEmail || '-');
  const price = Number(r.price || 0).toFixed(2);

  return `${date || '-'} ${time} | ${court} | ${status} | ${price} EUR | ${email}`;
}

function buildMessage(dateKey, reservations, tz) {
  if (!reservations.length) {
    return `Resumo automatico (${tz})\nReservas de ${dateKey}: 0`;
  }

  const maxItems = 30;
  const lines = reservations.slice(0, maxItems).map(formatReservation);
  const hidden = reservations.length - lines.length;

  const body = [
    `Resumo automatico (${tz})`,
    `Reservas de ${dateKey}: ${reservations.length}`,
    ...lines
  ];

  if (hidden > 0) {
    body.push(`... e mais ${hidden} reserva(s).`);
  }

  return body.join('\n');
}

async function sendTelegram(text) {
  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: true
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Telegram HTTP ${response.status}: ${payload}`);
  }
}

async function main() {
  const { dateKey, hour } = getLocalDateHour(REPORT_TIMEZONE);
  const allowedHours = parseHours(REPORT_HOURS);

  if (!allowedHours.includes(hour)) {
    console.log(`Skip: hora ${hour} fora das horas configuradas (${allowedHours.join(',')}).`);
    return;
  }

  const lockId = `${dateKey}-${hour}`;
  const lockRef = db.collection('jobLocks').doc(`telegram-report-${lockId}`);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    console.log(`Skip: resumo ${lockId} ja enviado.`);
    return;
  }

  const reservations = await getReservationsByDate(dateKey);
  const message = buildMessage(dateKey, reservations, REPORT_TIMEZONE);
  await sendTelegram(message);

  await lockRef.set({
    dateKey,
    hour,
    timezone: REPORT_TIMEZONE,
    sentAt: new Date().toISOString(),
    totalReservations: reservations.length
  });

  console.log(`Resumo enviado: ${lockId} (${reservations.length} reservas).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
