import { auth, db } from '../core/firebase-config.js';
import { doc, updateDoc, getDoc, collection, query, where, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Verificar se o browser suporta notificações
export function isNotificationSupported() {
    return 'Notification' in window && 'serviceWorker' in navigator;
}

// Pedir permissão para notificações
export async function requestNotificationPermission() {
    if (!isNotificationSupported()) {
        console.warn('Browser não suporta notificações');
        return false;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Permissão de notificações concedida');
            
            // Guardar preferência no Firestore
            if (auth.currentUser) {
                await updateDoc(doc(db, "users", auth.currentUser.uid), {
                    notificationsEnabled: true,
                    notificationPermission: 'granted'
                });
            }
            return true;
        } else {
            console.log('Permissão de notificações negada');
            return false;
        }
    } catch (error) {
        console.error('Erro ao pedir permissão:', error);
        return false;
    }
}

// Enviar notificação local
export function sendLocalNotification(title, body, data = {}) {
    if (!isNotificationSupported()) return;
    
    if (Notification.permission === 'granted') {
        const notification = new Notification(title, {
            body: body,
            icon: '/img/logo.png',
            badge: '/img/logo.png',
            tag: data.tag || 'padel-notification',
            requireInteraction: true,
            data: data
        });

        notification.onclick = function(event) {
            event.preventDefault();
            if (data.url) {
                window.open(data.url, '_blank');
            }
            notification.close();
        };
    }
}

// Verificar reservas próximas (1h antes)
export async function checkUpcomingReservations() {
    if (!auth.currentUser) return;

    try {
        const now = new Date();
        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

        const q = query(
            collection(db, "reservas"),
            where("userId", "==", auth.currentUser.uid),
            where("status", "==", "approved")
        );

        const snapshot = await getDocs(q);
        
        snapshot.forEach(doc => {
            const reserva = doc.data();
            const reservaDate = new Date(reserva.date + ' ' + reserva.time);
            
            // Verificar se está entre agora e 1h depois
            if (reservaDate > now && reservaDate <= oneHourLater) {
                // Verificar se já notificou (guardar em localStorage)
                const notifiedKey = `notified_${doc.id}`;
                if (!localStorage.getItem(notifiedKey)) {
                    sendLocalNotification(
                        '⏰ Reserva em 1 hora!',
                        `Campo ${reserva.court} às ${reserva.time}`,
                        {
                            tag: `reserva_${doc.id}`,
                            url: '/dashboard.html'
                        }
                    );
                    localStorage.setItem(notifiedKey, 'true');
                }
            }
        });
    } catch (error) {
        console.error('Erro ao verificar reservas:', error);
    }
}

// Notificar sobre mudança de status
export function notifyStatusChange(reserva, newStatus) {
    let title, body;
    
    switch(newStatus) {
        case 'approved':
            title = '✅ Reserva Aprovada!';
            body = `Campo ${reserva.court} - ${reserva.date} às ${reserva.time}`;
            break;
        case 'rejected':
            title = '❌ Reserva Recusada';
            body = `Campo ${reserva.court} - ${reserva.date} às ${reserva.time}`;
            break;
        case 'cancelled':
            title = '🚫 Reserva Cancelada';
            body = `Campo ${reserva.court} - ${reserva.date} às ${reserva.time}`;
            break;
        default:
            return;
    }
    
    sendLocalNotification(title, body, {
        tag: `status_${reserva.id}`,
        url: '/dashboard.html'
    });
}

// Inicializar sistema de notificações
export async function initNotificationSystem() {
    if (!isNotificationSupported()) return;

    // Verificar permissão atual
    if (Notification.permission === 'default') {
        // Mostrar banner para pedir permissão
        showNotificationBanner();
    }

    // Verificar reservas próximas a cada 5 minutos
    if (Notification.permission === 'granted') {
        checkUpcomingReservations();
        setInterval(checkUpcomingReservations, 5 * 60 * 1000);
    }
}

// Mostrar banner para ativar notificações
function showNotificationBanner() {
    const banner = document.createElement('div');
    banner.id = 'notification-banner';
    banner.className = 'alert alert-info position-fixed bottom-0 start-50 translate-middle-x mb-3 shadow-lg';
    banner.style.zIndex = '9999';
    banner.style.maxWidth = '500px';
    banner.innerHTML = `
        <div class="d-flex align-items-center gap-3">
            <i class="bi bi-bell-fill fs-4"></i>
            <div class="flex-grow-1">
                <strong>Ativar Notificações</strong>
                <p class="mb-0 small">Recebe avisos antes das tuas reservas</p>
            </div>
            <button class="btn btn-sm btn-success" id="enable-notifications">Ativar</button>
            <button class="btn btn-sm btn-secondary" id="dismiss-banner">Agora não</button>
        </div>
    `;
    
    document.body.appendChild(banner);
    
    document.getElementById('enable-notifications').addEventListener('click', async () => {
        await requestNotificationPermission();
        banner.remove();
    });
    
    document.getElementById('dismiss-banner').addEventListener('click', () => {
        banner.remove();
        localStorage.setItem('notification-banner-dismissed', Date.now());
    });
    
    // Não mostrar se já foi dispensado há menos de 1 dia
    const dismissed = localStorage.getItem('notification-banner-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 24 * 60 * 60 * 1000) {
        banner.remove();
    }
}
