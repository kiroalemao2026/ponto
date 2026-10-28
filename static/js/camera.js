// ============================================================
//  camera.js - Lógica da tela de bater ponto
// ============================================================

let streamCamera = null;
let processando = false;

const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

// ─── Relógio Digital ─────────────────────────────────────────
function iniciarRelogio() {
    function atualizar() {
        const agora = new Date();
        const h = String(agora.getHours()).padStart(2, '0');
        const m = String(agora.getMinutes()).padStart(2, '0');
        const s = String(agora.getSeconds()).padStart(2, '0');
        document.getElementById('relogio').textContent = `${h}:${m}:${s}`;

        const diaSemana = DIAS_SEMANA[agora.getDay()];
        const dia = String(agora.getDate()).padStart(2, '0');
        const mes = MESES[agora.getMonth()];
        const ano = agora.getFullYear();
        document.getElementById('data-atual').textContent = `${diaSemana}, ${dia} de ${mes} de ${ano}`;
    }
    atualizar();
    setInterval(atualizar, 1000);
}

// ─── Câmera ───────────────────────────────────────────────────
async function initCamera() {
    const video = document.getElementById('video-camera');
    const statusEl = document.getElementById('camera-status');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        statusEl.innerHTML = '<i class="fas fa-lock text-warning"></i> HTTPS Necessário';
        statusEl.style.color = '#ffc107';
        mostrarToast('Para o celular liberar a câmera, é necessário acessar via HTTPS ou permitir no navegador.');
        return;
    }

    try {
        const constraints = {
            video: {
                facingMode: { ideal: 'user' },
                width: { ideal: 640 },
                height: { ideal: 480 }
            },
            audio: false
        };

        streamCamera = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = streamCamera;
        await video.play().catch(() => {});
        statusEl.innerHTML = '<i class="fas fa-circle text-success"></i> Câmera ativa';
        statusEl.style.color = '#28a745';
    } catch (err) {
        console.error('Erro na câmera:', err);
        statusEl.innerHTML = '<button onclick="initCamera()" class="btn btn-sm btn-outline-danger p-0 px-2" style="font-size:0.75rem;"><i class="fas fa-redo"></i> Toque para ativar câmera</button>';
        statusEl.style.color = '#e94560';
        mostrarToast('Câmera bloqueada ou sem permissão. Clique no ícone do cadeado no topo do navegador para permitir.');
    }
}

function captureFrame() {
    const video = document.getElementById('video-camera');
    const canvas = document.getElementById('canvas-captura');

    if (!streamCamera || !video.videoWidth) {
        throw new Error('Câmera não está ativa.');
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.92);
}

// ─── Efeito de flash ──────────────────────────────────────────
function dispararFlash() {
    const flash = document.getElementById('flash-efeito');
    flash.classList.add('ativo');
    setTimeout(() => flash.classList.remove('ativo'), 300);
}

// ─── Registrar Ponto ─────────────────────────────────────────
async function registrarPonto(tipo) {
    if (processando) return;

    let imagemBase64;
    try {
        imagemBase64 = captureFrame();
    } catch (err) {
        mostrarToast('Câmera não disponível. ' + err.message);
        return;
    }

    processando = true;
    desabilitarBotoes(true);
    dispararFlash();
    ocultarResultado();
    mostrarProcessando(true);

    try {
        const resposta = await fetch('/api/ponto/registrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imagem_base64: imagemBase64, tipo: tipo })
        });

        const dados = await resposta.json();
        mostrarProcessando(false);

        if (dados.sucesso) {
            exibirResultadoSucesso(dados);
        } else {
            exibirResultadoErro(dados.mensagem, dados.tipo);
        }
    } catch (err) {
        mostrarProcessando(false);
        exibirResultadoErro('Erro de conexão com o servidor. Tente novamente.', '');
        console.error('Erro registro:', err);
    } finally {
        processando = false;
        desabilitarBotoes(false);
    }
}

// ─── Exibição de resultado ────────────────────────────────────
function ocultarResultado() {
    document.getElementById('card-resultado').classList.add('oculto');
}

function mostrarProcessando(sim) {
    const el = document.getElementById('card-processando');
    el.classList.toggle('oculto', !sim);
}

function exibirResultadoSucesso(dados) {
    const card = document.getElementById('card-resultado');
    card.className = 'card-resultado card-sucesso';

    // Foto
    const img = document.getElementById('resultado-foto-img');
    if (dados.foto_base64) {
        img.src = dados.foto_base64;
        img.style.display = 'block';
    } else {
        img.style.display = 'none';
    }

    document.getElementById('resultado-nome').textContent = dados.funcionario_nome;
    document.getElementById('resultado-cargo').textContent = dados.cargo + ' · ' + dados.departamento;
    document.getElementById('resultado-tipo').innerHTML = `<span class="badge-tipo badge-${dados.tipo}">${dados.tipo_label}</span>`;
    document.getElementById('resultado-hora').innerHTML = `<i class="fas fa-clock"></i> ${dados.timestamp}`;
    document.getElementById('resultado-confianca').innerHTML = dados.confianca
        ? `<i class="fas fa-fingerprint"></i> Confiança: ${dados.confianca}%`
        : '';

    document.getElementById('resultado-icone').innerHTML = '<i class="fas fa-check-circle text-success fa-3x"></i>';
    document.getElementById('resultado-mensagem').textContent = dados.mensagem;

    card.classList.remove('oculto');
    card.classList.add('card-animando');
    setTimeout(() => card.classList.remove('card-animando'), 600);
}

function exibirResultadoErro(mensagem, tipo) {
    const card = document.getElementById('card-resultado');
    card.className = 'card-resultado card-erro';

    document.getElementById('resultado-foto-img').style.display = 'none';
    document.getElementById('resultado-nome').textContent = 'Não Identificado';
    document.getElementById('resultado-cargo').textContent = '';
    document.getElementById('resultado-tipo').textContent = tipo || '';
    document.getElementById('resultado-hora').textContent = '';
    document.getElementById('resultado-confianca').textContent = '';
    document.getElementById('resultado-icone').innerHTML = '<i class="fas fa-times-circle text-danger fa-3x"></i>';
    document.getElementById('resultado-mensagem').textContent = mensagem;

    card.classList.remove('oculto');
    card.classList.add('card-animando');
    setTimeout(() => card.classList.remove('card-animando'), 600);
}

// ─── Botões ───────────────────────────────────────────────────
function desabilitarBotoes(desabilitar) {
    ['btn-entrada', 'btn-almoco-saida', 'btn-almoco-retorno', 'btn-saida'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = desabilitar;
    });
}

// ─── Feed de últimos registros ────────────────────────────────
async function carregarFeed() {
    const feed = document.getElementById('feed-registros');
    try {
        const r = await fetch('/api/ponto/ultimos');
        if (!r.ok) return;
        const registros = await r.json();

        if (!registros.length) {
            feed.innerHTML = '<div class="text-center text-muted py-3">Nenhum registro</div>';
            return;
        }

        const tipoIcone = {
            entrada: 'fas fa-sign-in-alt text-success',
            saida: 'fas fa-sign-out-alt text-danger',
            almoco_saida: 'fas fa-utensils text-warning',
            almoco_retorno: 'fas fa-undo text-info'
        };

        feed.innerHTML = registros.map(r => `
            <div class="feed-item">
                <div class="feed-foto">
                    ${r.foto_base64
                        ? `<img src="${r.foto_base64}" alt="${r.funcionario_nome}">`
                        : `<div class="feed-avatar"><i class="fas fa-user"></i></div>`}
                </div>
                <div class="feed-dados">
                    <div class="feed-nome">${r.funcionario_nome}</div>
                    <div class="feed-detalhe">
                        <i class="${tipoIcone[r.tipo] || 'fas fa-clock text-muted'}"></i>
                        ${r.tipo_label}
                    </div>
                    <div class="feed-hora">${r.timestamp}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error('Feed:', e);
    }
}

// ─── Toast de erro ────────────────────────────────────────────
function mostrarToast(msg) {
    document.getElementById('toast-msg').textContent = msg;
    const toastEl = document.getElementById('toast-camera');
    new bootstrap.Toast(toastEl, { delay: 5000 }).show();
}
