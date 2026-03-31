import { initializeApp } from 'firebase-admin/app';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

initializeApp();

const TELEGRAM_BOT_TOKEN = defineSecret('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = defineSecret('TELEGRAM_CHAT_ID');

function formatReservationMessage(data, reservationId) {
  const dateTime = data.datetime || '-';
  const court = data.courtId || 'Campo';
  const status = data.status || 'Pendente';
  const email = data.userEmail || 'sem-email';
  const price = Number(data.price || 0);

  return [
    'Nova reserva criada',
    `ID: ${reservationId}`,
    `Cliente: ${email}`,
    `Campo: ${court}`,
    `Data/Hora: ${dateTime}`,
    `Estado: ${status}`,
    `Preco: ${price.toFixed(2)} EUR`
  ].join('\n');
}

export const notifyTelegramOnReservation = onDocumentCreated(
  {
    document: 'reservas/{reservationId}',
    region: 'europe-west1',
    secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID]
  },
  async (event) => {
    const snap = event.data;
    if (!snap) {
      logger.warn('Evento sem dados de reserva.');
      return;
    }

    const reservation = snap.data() || {};
    const reservationId = event.params.reservationId;

    // Enviar apenas reservas novas em estado pendente.
    if ((reservation.status || 'Pendente') !== 'Pendente') {
      logger.info('Reserva ignorada por estado diferente de Pendente.', { reservationId, status: reservation.status });
      return;
    }

    const botToken = TELEGRAM_BOT_TOKEN.value();
    const chatId = TELEGRAM_CHAT_ID.value();

    if (!botToken || !chatId) {
      logger.error('Segredos TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID não configurados.');
      return;
    }

    const text = formatReservationMessage(reservation, reservationId);
    const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error('Falha ao enviar notificação Telegram.', {
        reservationId,
        status: response.status,
        body: errorBody
      });
      return;
    }

    logger.info('Notificação Telegram enviada com sucesso.', { reservationId });
  }
);
