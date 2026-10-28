// ============================================================
//  admin.js - Utilitários para o painel administrativo
// ============================================================

// ─── Autenticação ────────────────────────────────────────────
function verificarAuth() {
    const token = localStorage.getItem('ponto_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    // Verifica token no servidor
    fetch('/api/auth/verificar', {
        headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => {
        if (!r.ok) {
            localStorage.removeItem('ponto_token');
            localStorage.removeItem('ponto_admin_nome');
            window.location.href = '/login';
        }
    }).catch(() => {
        // Mantem sessão em caso de erro de rede temporário
    });
}

function fazerLogout() {
    localStorage.removeItem('ponto_token');
    localStorage.removeItem('ponto_admin_nome');
    window.location.href = '/login';
}

// ─── Fetch autenticado ────────────────────────────────────────
async function fetchAuth(url, opcoes = {}) {
    const token = localStorage.getItem('ponto_token');
    const headers = opcoes.headers || {};

    // Não define Content-Type se for FormData (o browser define automaticamente com boundary)
    if (!(opcoes.body instanceof FormData)) {
        if (!headers['Content-Type'] && opcoes.method && opcoes.method !== 'GET') {
            headers['Content-Type'] = 'application/json';
        }
    }

    headers['Authorization'] = 'Bearer ' + token;

    const config = {
        ...opcoes,
        headers
    };

    const resposta = await fetch(url, config);

    if (resposta.status === 401) {
        localStorage.removeItem('ponto_token');
        window.location.href = '/login';
        return resposta;
    }

    return resposta;
}
