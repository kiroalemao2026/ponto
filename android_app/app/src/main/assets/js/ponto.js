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

    // Botões liberados imediatamente para o registro por foto
    liberarBotoes(true);

  } catch (err) {
    console.error('Erro ao abrir câmera:', err);
    status.innerHTML = '<button onclick="iniciarCamera()" class="btn btn-sm btn-outline-danger" style="font-size:.75rem"><i class="fas fa-redo me-1"></i>Toque para ativar câmera</button>';
    // Mesmo se a câmera demorar para responder, mantém os botões disponíveis
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

// ─── Registrar Ponto (Foto + Firestore) ──────────────────
async function registrarPonto(tipo) {
  if (processando || !funcionarioAtual) return;

  processando = true;
  liberarBotoes(false);

  // Abre na tela o modal destacado "Registrando ponto..."
  abrirOverlayProcessando();

  const video = document.getElementById('video');
  let fotoSnapshot = null;

  try {
    // 1. Tira foto instantânea da câmera no momento do clique
    const capCanvas = document.createElement('canvas');
    capCanvas.width = 320;
    capCanvas.height = 240;
    const capCtx = capCanvas.getContext('2d');

    if (video && video.videoWidth) {
      capCtx.drawImage(video, 0, 0, 320, 240);
      fotoSnapshot = capCanvas.toDataURL('image/jpeg', 0.8);
    } else if (funcionarioAtual.fotoUrl) {
      fotoSnapshot = funcionarioAtual.fotoUrl;
    }

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
