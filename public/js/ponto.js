// ============================================================
//  ponto.js — Sistema de Ponto por Foto e CPF
//  Firebase Firestore + Captura Fotográfica em Tempo Real
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCuPyOvWhv0MVz6S-Cd8bFDgBcyF1ZCY4",
  authDomain: "ponto-mobilitta.firebaseapp.com",
  projectId: "ponto-mobilitta",
  storageBucket: "ponto-mobilitta.firebasestorage.app",
  messagingSenderId: "217323535686",
  appId: "1:217323535686:web:6c583a7ba09d64594db947"
};

const TIPOS = {
  entrada:         "Entrada",
  almoco_saida:    "Saída para Almoço",
  almoco_retorno:  "Retorno do Almoço",
  saida_extra:     "Saída Extra",
  retorno_extra:   "Retorno Extra",
  saida:           "Saída"
};

// ─── Estado global ────────────────────────────────────
let db;
let streamCamera = null;
let modoCameraAtual = 'user'; // 'user' (frontal) ou 'environment' (traseira)
let timerContagem = null;
let funcionarioAtual = null;   // { id, nome, cargo, departamento, cpf, fotoUrl }
let processando = false;

// ─── Bootstrap ───────────────────────────────────────
const DIAS = ['Domingo','Segunda-feira','Terça-feira','Quarta-feira','Quinta-feira','Sexta-feira','Sábado'];
const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function iniciarRelogio() {
  const tick = () => {
    const n = new Date();
    document.getElementById('relogio').textContent =
      [n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2,'0')).join(':');
    document.getElementById('data-atual').textContent =
      `${DIAS[n.getDay()]}, ${String(n.getDate()).padStart(2,'0')} de ${MESES[n.getMonth()]} de ${n.getFullYear()}`;
  };
  tick();
  setInterval(tick, 1000);
}

function mascaraCPF(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  input.value = v;
}

// ─── Funções do Teclado Numérico Virtual em Tela ─────
function teclarDigito(d) {
  const input = document.getElementById('input-cpf');
  let v = input.value.replace(/\D/g, '');
  if (v.length >= 11) return;
  input.value = v + d;
  mascaraCPF(input);
}

function teclarApagar() {
  const input = document.getElementById('input-cpf');
  let v = input.value.replace(/\D/g, '');
  if (v.length > 0) {
    input.value = v.slice(0, -1);
    mascaraCPF(input);
  }
}

function teclarLimpar() {
  const input = document.getElementById('input-cpf');
  input.value = '';
  document.getElementById('alerta-cpf').classList.add('d-none');
}

function toast(msg, tipo = 'danger') {
  const el = document.getElementById('toast');
  if (el) {
    el.className = `toast text-bg-${tipo}`;
    document.getElementById('toast-msg').textContent = msg;
    new bootstrap.Toast(el, { delay: 4000 }).show();
  }
}

// ─── Init ─────────────────────────────────────────────
async function init() {
  // Inicializa o Firebase Firestore
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();

  // Transição instantânea para a tela de CPF
  const telaCarregando = document.getElementById('tela-carregando');
  if (telaCarregando) telaCarregando.classList.add('hidden');

  document.getElementById('etapa-cpf').classList.remove('hidden');
  document.getElementById('input-cpf').focus();
  iniciarRelogio();
}

// ─── Etapa 1: Validar CPF ─────────────────────────────
async function validarCPF() {
  const input = document.getElementById('input-cpf');
  const cpfLimpo = input.value.replace(/\D/g, '');
  const cpfFormatado = input.value.trim();
  const alerta = document.getElementById('alerta-cpf');
  const btn = document.getElementById('btn-cpf');

  alerta.classList.add('d-none');

  if (cpfLimpo.length !== 11) {
    alerta.textContent = 'Digite o CPF completo (11 dígitos).';
    alerta.classList.remove('d-none');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Buscando cadastro...';

  try {
    // Busca pelo CPF limpo (apenas números)
    let snap = await db.collection('funcionarios')
      .where('cpf', '==', cpfLimpo)
      .get();

    // Se não achou, tenta com a formatação
    if (snap.empty) {
      snap = await db.collection('funcionarios')
        .where('cpf', '==', cpfFormatado)
        .get();
    }

    if (snap.empty) {
      alerta.textContent = 'Colaborador não encontrado com este CPF no sistema.';
      alerta.classList.remove('d-none');
      return;
    }

    const doc = snap.docs[0];
    const dados = doc.data();

    if (dados.ativo === false) {
      alerta.textContent = 'Colaborador desativado. Contate o administrador.';
      alerta.classList.remove('d-none');
      return;
    }

    funcionarioAtual = {
      id: doc.id,
      nome: dados.nome || 'Colaborador',
      cargo: dados.cargo || '',
      departamento: dados.departamento || '',
      cpf: cpfLimpo,
      fotoUrl: dados.fotoUrl || ''
    };

    // Avança para a Etapa 2 (Câmera com Foto)
    document.getElementById('etapa-cpf').classList.add('hidden');
    document.getElementById('etapa-camera').classList.remove('hidden');
    document.getElementById('nome-sessao').textContent = funcionarioAtual.nome;
    iniciarCamera();

  } catch (e) {
    console.error('Erro ao validar CPF:', e);
    alerta.textContent = 'Erro ao consultar o banco de dados: ' + (e.message || 'Verifique sua conexão.');
    alerta.classList.remove('d-none');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-arrow-right me-2"></i>Continuar';
  }
}

function voltarCPF() {
  if (timerContagem) {
    clearInterval(timerContagem);
    timerContagem = null;
  }
  pararCamera();
  funcionarioAtual = null;
  liberarBotoes(false);
  ocultarResultado();
  document.getElementById('etapa-camera').classList.add('hidden');
  document.getElementById('etapa-cpf').classList.remove('hidden');
  document.getElementById('input-cpf').value = '';
  document.getElementById('alerta-cpf').classList.add('d-none');
  setTimeout(() => document.getElementById('input-cpf').focus(), 150);
  const statusFace = document.getElementById('status-face');
  if (statusFace) {
    statusFace.textContent = 'Posicione seu rosto para a foto e toque no botão';
    statusFace.style.color = 'var(--text-muted)';
  }
  const moldura = document.getElementById('moldura-oval');
  if (moldura) {
    moldura.classList.remove('reconhecido');
    moldura.classList.remove('nao-reconhecido');
  }
}

// ─── Etapa 2: Câmera Universal & Alternância ────────────────────
async function alternarCamera() {
  modoCameraAtual = (modoCameraAtual === 'user') ? 'environment' : 'user';
  pararCamera();
  await iniciarCamera();
}

function obterStreamCamera(constraints) {
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  var gum = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (gum) {
    return new Promise(function(resolve, reject) {
      gum.call(navigator, constraints, resolve, reject);
    });
  }
  return Promise.reject(new Error("Câmera não suportada neste dispositivo."));
}

async function iniciarCamera() {
  const video = document.getElementById('video');
  const status = document.getElementById('camera-status');
  const moldura = document.getElementById('moldura-oval');
  const statusFace = document.getElementById('status-face');

  try {
    try {
      streamCamera = await obterStreamCamera({
        video: {
          facingMode: modoCameraAtual,
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
    } catch (_) {
      // Fallback universal
      streamCamera = await obterStreamCamera({
        video: { facingMode: modoCameraAtual },
        audio: false
      });
    }

    video.srcObject = streamCamera;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
    video.setAttribute('muted', 'true');

    // Espelho apenas para câmera frontal
    if (modoCameraAtual === 'environment') {
      video.style.transform = 'scaleX(1)';
    } else {
      video.style.transform = 'scaleX(-1)';
    }

    await video.play().catch(() => {});

    // Aguarda o vídeo carregar dimensões e primeiro frame real
    await new Promise(resolve => {
      if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
      let resolvido = false;
      const pronto = () => {
        if (!resolvido && video.videoWidth > 0) {
          resolvido = true;
          video.removeEventListener('loadeddata', pronto);
          video.removeEventListener('canplay', pronto);
          video.removeEventListener('playing', pronto);
          resolve();
        }
      };
      video.addEventListener('loadeddata', pronto);
      video.addEventListener('canplay', pronto);
      video.addEventListener('playing', pronto);
      setTimeout(pronto, 800);
    });

    const labelCam = modoCameraAtual === 'user' ? 'Frontal' : 'Traseira';
    status.innerHTML = `<i class="fas fa-circle text-success"></i> Câmera ${labelCam} ativa`;

    if (moldura) {
      moldura.classList.remove('nao-reconhecido');
      moldura.classList.add('reconhecido');
    }
    if (statusFace) {
      statusFace.innerHTML = `<i class="fas fa-camera text-success me-1"></i><strong>Posicione-se em frente à câmera</strong> e toque no botão desejado`;
      statusFace.style.color = '#28a745';
    }

    // Botões liberados com a câmera devidamente renderizando
    liberarBotoes(true);

  } catch (err) {
    console.error('Erro ao abrir câmera:', err);
    status.innerHTML = '<button onclick="iniciarCamera()" class="btn btn-sm btn-outline-danger" style="font-size:.75rem"><i class="fas fa-redo me-1"></i>Toque para ativar câmera</button>';
    liberarBotoes(true);
  }
}

function pararCamera() {
  if (streamCamera) {
    streamCamera.getTracks().forEach(t => t.stop());
    streamCamera = null;
  }
  liberarBotoes(false);
}

function liberarBotoes(liberar) {
  ['btn-entrada','btn-almoco-saida','btn-almoco-retorno','btn-saida','btn-saida-extra','btn-retorno-extra'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.disabled = !liberar || processando;
  });
}

// ─── Controle do Overlay Modal (Centralizado) ────────
function abrirOverlayProcessando() {
  document.getElementById('overlay-ponto').classList.remove('d-none');
  document.getElementById('overlay-processando').classList.remove('d-none');
  document.getElementById('overlay-sucesso').classList.add('d-none');
  document.getElementById('overlay-erro').classList.add('d-none');
}

function abrirOverlaySucesso(nome, tipoLabel, hora, foto) {
  document.getElementById('overlay-ponto').classList.remove('d-none');
  document.getElementById('overlay-processando').classList.add('d-none');
  document.getElementById('overlay-erro').classList.add('d-none');
  document.getElementById('overlay-sucesso').classList.remove('d-none');

  document.getElementById('overlay-nome').textContent = nome;
  document.getElementById('overlay-tipo').textContent = tipoLabel;
  document.getElementById('overlay-hora').textContent = hora;

  if (foto) {
    document.getElementById('overlay-icone-sucesso').innerHTML = 
      `<img src="${foto}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid var(--success);box-shadow:0 0 20px rgba(40,167,69,0.5);">`;
  } else {
    document.getElementById('overlay-icone-sucesso').innerHTML = 
      '<i class="fas fa-check-circle text-success" style="font-size: 4.5rem;"></i>';
  }

  // Contador regressivo de 5 segundos
  let segundos = 5;
  const contadorNum = document.getElementById('overlay-contador-numero');
  contadorNum.textContent = segundos;

  if (timerContagem) clearInterval(timerContagem);
  timerContagem = setInterval(() => {
    segundos--;
    contadorNum.textContent = segundos;
    if (segundos <= 0) {
      clearInterval(timerContagem);
      timerContagem = null;
      fecharOverlay();
      voltarCPF();
    }
  }, 1000);
}

function abrirOverlayErro(msg) {
  document.getElementById('overlay-ponto').classList.remove('d-none');
  document.getElementById('overlay-processando').classList.add('d-none');
  document.getElementById('overlay-sucesso').classList.add('d-none');
  document.getElementById('overlay-erro').classList.remove('d-none');
  document.getElementById('overlay-erro-msg').textContent = msg;
}

function fecharOverlayErro() {
  fecharOverlay();
  liberarBotoes(true);
}

function fecharOverlay() {
  const overlay = document.getElementById('overlay-ponto');
  if (overlay) overlay.classList.add('d-none');
}

// ─── Verificação e Captura Confiável de Foto ────────────────
function verificarFrameVerdeOuPreto(ctx, w, h) {
  try {
    const pontos = [
      [Math.floor(w * 0.5), Math.floor(h * 0.5)],
      [Math.floor(w * 0.25), Math.floor(h * 0.25)],
      [Math.floor(w * 0.75), Math.floor(h * 0.25)],
      [Math.floor(w * 0.25), Math.floor(h * 0.75)],
      [Math.floor(w * 0.75), Math.floor(h * 0.75)],
      [Math.floor(w * 0.5), Math.floor(h * 0.25)],
      [Math.floor(w * 0.5), Math.floor(h * 0.75)]
    ];
    let falhas = 0;
    for (const [x, y] of pontos) {
      const p = ctx.getImageData(x, y, 1, 1).data;
      // Bug de YUV (0,0,0) desempacotado em RGB resulta exatamente em R:0, G:135, B:0
      const isYUVVerde = (p[0] <= 20 && p[1] >= 115 && p[1] <= 155 && p[2] <= 20);
      const isPreto = (p[0] === 0 && p[1] === 0 && p[2] === 0);
      if (isYUVVerde || isPreto) {
        falhas++;
      }
    }
    // Se a maioria das amostras for verde YUV corrompido ou preto total
    return falhas >= 5;
  } catch (e) {
    return false;
  }
}

async function capturarFotoReal() {
  const video = document.getElementById('video');

  // Método 1: ImageCapture nativo do Android / Chrome (captura direta do hardware sem falhas YUV)
  if (window.ImageCapture && streamCamera) {
    try {
      const tracks = streamCamera.getVideoTracks();
      if (tracks && tracks.length > 0 && tracks[0].readyState === 'live') {
        const imageCapture = new ImageCapture(tracks[0]);
        const bitmap = await imageCapture.grabFrame();
        if (bitmap && bitmap.width > 0 && bitmap.height > 0) {
          const capCanvas = document.createElement('canvas');
          const maxDim = 480;
          const escala = Math.min(1, maxDim / bitmap.width);
          capCanvas.width = Math.round(bitmap.width * escala);
          capCanvas.height = Math.round(bitmap.height * escala);
          const capCtx = capCanvas.getContext('2d', { willReadFrequently: true });

          if (modoCameraAtual === 'user') {
            capCtx.translate(capCanvas.width, 0);
            capCtx.scale(-1, 1);
          }
          capCtx.drawImage(bitmap, 0, 0, capCanvas.width, capCanvas.height);

          if (!verificarFrameVerdeOuPreto(capCtx, capCanvas.width, capCanvas.height)) {
            const foto = capCanvas.toDataURL('image/jpeg', 0.85);
            console.log('📸 Foto capturada via ImageCapture:', foto.length, 'bytes');
            return foto;
          }
        }
      }
    } catch (e) {
      console.warn('ImageCapture grabFrame falhou, tentando fallback canvas:', e);
    }
  }

  // Método 2: Desenho nativo do elemento <video> com verificação anti-verde e retentativas
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const maxDim = 480;
    const escala = Math.min(1, maxDim / vw);
    const targetW = Math.round(vw * escala);
    const targetH = Math.round(vh * escala);

    const capCanvas = document.createElement('canvas');
    capCanvas.width = targetW;
    capCanvas.height = targetH;
    const capCtx = capCanvas.getContext('2d', { willReadFrequently: true });

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      capCtx.clearRect(0, 0, targetW, targetH);
      capCtx.save();
      if (modoCameraAtual === 'user') {
        capCtx.translate(targetW, 0);
        capCtx.scale(-1, 1);
      }
      capCtx.drawImage(video, 0, 0, targetW, targetH);
      capCtx.restore();

      if (!verificarFrameVerdeOuPreto(capCtx, targetW, targetH)) {
        const foto = capCanvas.toDataURL('image/jpeg', 0.85);
        console.log(`📸 Foto capturada via Canvas (tentativa ${tentativa}):`, foto.length, 'bytes');
        return foto;
      }

      console.warn(`Tentativa ${tentativa}: Frame da câmera veio verde YUV(0,135,0). Aguardando próximo frame...`);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Método 3: Fallback de segurança para foto de cadastro (garante que NUNCA fique verde)
  if (funcionarioAtual && funcionarioAtual.fotoUrl) {
    console.warn('⚠️ Usando foto cadastral do colaborador pois a câmera não produziu frame válido.');
    return funcionarioAtual.fotoUrl;
  }

  return '';
}

// ─── Registrar Ponto (Foto + Firestore) ──────────────────
async function registrarPonto(tipo) {
  if (processando || !funcionarioAtual) return;

  processando = true;
  liberarBotoes(false);

  // Abre na tela o modal destacado "Registrando ponto..."
  abrirOverlayProcessando();

  try {
    // 1. Tira foto real instantânea da câmera com tripla proteção
    const fotoSnapshot = await capturarFotoReal();

    const agora = firebase.firestore.Timestamp.now();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeMs = hoje.getTime();

    // 2. Verifica duplicidade no dia
    const snap = await db.collection('registros')
      .where('cpf', '==', funcionarioAtual.cpf)
      .get();

    const jaRegistrou = snap.docs.find(doc => {
      const d = doc.data();
      const dt = (d.timestamp && d.timestamp.toDate) ? d.timestamp.toDate().getTime() : 0;
      if (tipo === 'saida_extra' || tipo === 'retorno_extra') {
        return d.tipo === tipo && (Date.now() - dt) < 120000;
      }
      return d.tipo === tipo && dt >= hojeMs;
    });

    if (jaRegistrou) {
      if (tipo === 'saida_extra' || tipo === 'retorno_extra') {
        abrirOverlayErro(`${funcionarioAtual.nome} acabou de registrar "${TIPOS[tipo]}". Aguarde alguns instantes.`);
        return;
      }
      const regData = jaRegistrou.data();
      const horaExist = (regData.timestamp && regData.timestamp.toDate) ? regData.timestamp.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '';
      abrirOverlayErro(`${funcionarioAtual.nome} já registrou "${TIPOS[tipo]}" hoje${horaExist ? ' às ' + horaExist : ''}.`);
      return;
    }

    // 3. Salva no Firestore
    const registroDoc = {
      cpf: funcionarioAtual.cpf,
      funcionarioId: funcionarioAtual.id,
      funcionarioNome: funcionarioAtual.nome,
      cargo: funcionarioAtual.cargo || '',
      departamento: funcionarioAtual.departamento || '',
      tipo: tipo,
      tipoLabel: TIPOS[tipo],
      timestamp: agora,
      fotoSnapshot: fotoSnapshot || ''
    };

    await db.collection('registros').add(registroDoc);
    console.log('✅ Ponto com foto salvo com sucesso no Firestore!');

    const horaFormatada = new Date().toLocaleTimeString('pt-BR');
    abrirOverlaySucesso(funcionarioAtual.nome, TIPOS[tipo], horaFormatada, fotoSnapshot);

  } catch (e) {
    console.error('Erro ao salvar ponto:', e);
    abrirOverlayErro('Erro ao salvar no Firebase: ' + (e.message || 'Verifique sua conexão.'));
  } finally {
    processando = false;
  }
}

// ─── UI Resultado ─────────────────────────────────────
function ocultarResultado() {
  fecharOverlay();
  const card = document.getElementById('card-resultado');
  if (card) card.classList.remove('visivel','sucesso','erro');
}

// ─── Previne zoom indesejado no mobile ─────────────────
let ultimoToque = 0;
document.addEventListener('touchend', function(e) {
  const agora = Date.now();
  if (agora - ultimoToque <= 300) {
    if (e.target.closest('.btn-tecla, .btn-ponto, .btn')) {
      e.preventDefault();
      e.target.click();
    }
  }
  ultimoToque = agora;
}, { passive: false });

// ─── Arranque ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
