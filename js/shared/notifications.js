// Notificações In-App Toast System

class NotificationSystem {
    constructor() {
        this.container = null;
        this.init();
    }

    init() {
        // Criar container se não existir
        if (!document.getElementById('toast-container')) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        } else {
            this.container = document.getElementById('toast-container');
        }
    }

    show(title, message, type = 'info', duration = 4000) {
        const toast = document.createElement('div');
        toast.className = `app-toast ${type}`;

        // Ícones por tipo
        const icons = {
            success: '<i class="bi bi-check-circle-fill"></i>',
            error: '<i class="bi bi-exclamation-circle-fill"></i>',
            warning: '<i class="bi bi-exclamation-triangle-fill"></i>',
            info: '<i class="bi bi-info-circle-fill"></i>'
        };

        toast.innerHTML = `
            <div class="app-toast-icon">${icons[type] || icons.info}</div>
            <div class="app-toast-content">
                <div class="app-toast-title">${title}</div>
                <div class="app-toast-message">${message}</div>
            </div>
            <div class="app-toast-close" onclick="this.parentElement.remove()">×</div>
        `;

        this.container.appendChild(toast);

        // Auto-remover após duration
        if (duration > 0) {
            setTimeout(() => {
                toast.classList.add('exit');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }
    }

    success(title, message, duration) {
        this.show(title, message, 'success', duration);
    }

    error(title, message, duration) {
        this.show(title, message, 'error', duration);
    }

    warning(title, message, duration) {
        this.show(title, message, 'warning', duration);
    }

    info(title, message, duration) {
        this.show(title, message, 'info', duration);
    }
}

// Exportar como global para uso em qualquer página
window.Notification = new NotificationSystem();
