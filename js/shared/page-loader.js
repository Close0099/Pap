(() => {
    // Seleciona o elemento principal do loader
    const loader = document.getElementById('page-loader');
    if (!loader) return;

    // Configuração de UX/performance
    const minVisibleMs = 650;  // Evita flicker em ligações muito rápidas
    const hardTimeoutMs = 7000; // Fallback para nunca prender o utilizador
    const startTime = performance.now();
    let isHidden = false;

    // Bloqueia scroll enquanto o loader estiver visível
    document.body.classList.add('is-loading');

    // Esconde o loader com transição suave
    const hideLoader = () => {
        if (isHidden) return;
        isHidden = true;

        const elapsed = performance.now() - startTime;
        const remaining = Math.max(0, minVisibleMs - elapsed);

        window.setTimeout(() => {
            loader.classList.add('is-hiding');
            loader.setAttribute('aria-hidden', 'true');
            document.body.classList.remove('is-loading');

            // Remove do DOM ao fim da transição
            loader.addEventListener('transitionend', () => loader.remove(), { once: true });

            // Fallback extra caso o transitionend não dispare
            window.setTimeout(() => {
                if (loader.isConnected) loader.remove();
            }, 900);
        }, remaining);
    };

    // Fluxo principal: quando todos os assets terminarem de carregar
    window.addEventListener('load', hideLoader, { once: true });

    // Fallback de segurança
    window.setTimeout(hideLoader, hardTimeoutMs);
})();
