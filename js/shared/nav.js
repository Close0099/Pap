import { auth } from '../core/firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

function currentPath() {
  try { return location.pathname.split('/').pop() || 'dashboard.html'; } catch { return 'dashboard.html'; }
}

function isActive(href) {
  return currentPath() === href ? 'active' : '';
}

function renderNavbar(user) {
  const container = document.getElementById('app-navbar');
  if (!container) return;

  const showGreeting = currentPath() === 'dashboard.html';
  const greetingHtml = showGreeting
    ? `<li class="nav-item d-flex align-items-center">
        <small class="text-secondary d-none d-md-inline me-1">Olá,</small>
        <a href="profile.html" id="user-name" class="text-white fw-bold text-decoration-none hover-underline">${user?.email?.split('@')[0] || 'Utilizador'}</a>
       </li>`
    : '';

  container.innerHTML = `
    <nav class="navbar navbar-expand-lg navbar-dark navbar-custom border-bottom border-secondary">
      <div class="container">
        <a class="navbar-brand fw-bold" href="dashboard.html">
          Smash<span class="text-padel">Lab</span>
        </a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#mainNav">
          <span class="navbar-toggler-icon"></span>
        </button>
          <div class="collapse navbar-collapse" id="mainNav">
            <ul class="navbar-nav ms-auto align-items-lg-center gap-3">
              <li class="nav-item"><a class="nav-link ${isActive('dashboard.html')}" href="dashboard.html"><i class="bi bi-house-door"></i> Dashboard</a></li>
              <li class="nav-item"><a class="nav-link ${isActive('calendar.html')}" href="calendar.html"><i class="bi bi-calendar3"></i> Calendário</a></li>
              <li class="nav-item"><a class="nav-link ${isActive('profile.html')}" href="profile.html"><i class="bi bi-person"></i> Perfil</a></li>
              <li class="nav-item">
                <div class="position-relative">
                  <button id="message-badge-btn" class="btn btn-sm btn-outline-info position-relative d-none" type="button">
                    <i class="bi bi-envelope-fill"></i>
                    <span id="message-count-badge" class="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger">0</span>
                  </button>
                </div>
              </li>
              ${greetingHtml}
              <li class="nav-item">
                <button id="logout-btn" class="btn btn-outline-danger btn-sm ms-lg-2"><i class="bi bi-box-arrow-right"></i> Sair</button>
              </li>
            </ul>
          </div>
      </div>
    </nav>
  `;

  const logoutBtn = container.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      if (window.logout) { // usa função existente se houver
        return window.logout();
      }
      try {
        await signOut(auth);
        location.href = 'index.html';
      } catch (e) {
        console.error('Erro ao sair:', e);
      }
    });
  }
}

// Render imediato; se não autenticado, a página deve redirecionar pelos seus próprios guardas
onAuthStateChanged(auth, (user) => renderNavbar(user));

document.addEventListener('DOMContentLoaded', () => renderNavbar(auth.currentUser));
