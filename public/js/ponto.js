// ============================================================
//  ponto.js — Lógica principal da tela de bater ponto
//  Firebase Firestore + face-api.js (browser-only)
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCuPyOvWhv0MVz6S-Cd8bFDgBcyF1ZCY4",
  authDomain: "ponto-mobilitta.firebaseapp.com",
  projectId: "ponto-mobilitta",
  storageBucket: "ponto-mobilitta.firebasestorage.app",
  messagingSenderId: "217323535686",
  appId: "1:217323535686:web:6c583a7ba09d64594db947"
};

const MODELOS_URL = "/models";
const TIPOS = {
  entrada:         "Entrada",
  almoco_saida:    "Saída para Almoço",
  almoco_retorno:  "Retorno do Almoço",
  saida_extra:     "Saída Extra",
  retorno_extra:   "Retorno Extra",
  saida:           "Saída"
};
// Limiar de tolerância biométrica (menor = mais idêntico)
// 0.58 é o padrão ouro para câmeras de tablet/celular/webcams reais com ruído ou luz ambiente variável
const LIMIAR_SIMILARIDADE = 0.58;
const LIMIAR_SIMILARIDADE_PADRAO = 0.58;

// ─── Estado global ────────────────────────────────────
let db;
let streamCamera = null;
let loopAtivo = false;
let isAnalyzing = false;
let modoCameraAtual = 'user'; // 'user' (frontal) ou 'environment' (traseira)
let timerContagem = null;
let funcionarioAtual = null;   // { id, nome, cargo, departamento, cpf, faceDescriptor }
let faceReconhecida = false;
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
  el.className = `toast text-bg-${tipo}`;
  document.getElementById('toast-msg').textContent = msg;
  new bootstrap.Toast(el, { delay: 4000 }).show();
}

// ─── Init ─────────────────────────────────────────────
async function init() {
  // Firebase
  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();

  // Carregar modelos face-api.js
  document.getElementById('msg-carregando').textContent = 'Carregando reconhecimento facial (pode levar alguns segundos)...';
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODELOS_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODELOS_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODELOS_URL),
    ]);
  } catch (e) {
    console.error('Erro ao carregar modelos:', e);
    document.getElementById('msg-carregando').textContent = 'Erro ao carregar modelos. Verifique a conexão.';
    return;
  }

  document.getElementById('tela-carregando').classList.add('hidden');
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

    // Se não achou, tenta com a formatação (ex: 040.522.251-39)
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

    let rawDesc = dados.faceDescriptor;
    if (typeof rawDesc === 'string') {
      try { rawDesc = JSON.parse(rawDesc); } catch (_) {}
    }
    if (rawDesc && typeof rawDesc === 'object' && !Array.isArray(rawDesc)) {
      rawDesc = Object.values(rawDesc);
    }

    if (!rawDesc || rawDesc.length === 0) {
      alerta.textContent = 'Colaborador sem biometria facial cadastrada no Firebase. Acesse o painel admin para cadastrar a foto.';
      alerta.classList.remove('d-none');
      return;
    }

    const descriptorArray = new Float32Array(Array.from(rawDesc).map(Number));
    console.log('Biometria carregada com sucesso. Dimensões:', descriptorArray.length);

    // Converte para Float32Array
    funcionarioAtual = {
      id: doc.id,
      nome: dados.nome || 'Colaborador',
      cargo: dados.cargo || '',
      departamento: dados.departamento || '',
      cpf: cpfLimpo,
      fotoUrl: dados.fotoUrl || '',
      faceDescriptor: descriptorArray
    };

    // Avança para a Etapa 2 (Câmera)
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
  faceReconhecida = false;
  liberarBotoes(false);
  ocultarResultado();
  document.getElementById('etapa-camera').classList.add('hidden');
  document.getElementById('etapa-cpf').classList.remove('hidden');
  document.getElementById('input-cpf').value = '';
  document.getElementById('alerta-cpf').classList.add('d-none');
  setTimeout(() => document.getElementById('input-cpf').focus(), 150);
  document.getElementById('status-face').textContent = 'Posicione seu rosto no enquadramento';
  document.getElementById('status-face').style.color = 'var(--text-muted)';
  const moldura = document.getElementById('moldura-oval');
  if (moldura) moldura.classList.remove('reconhecido');
}

// ─── Etapa 2: Câmera & Alternância ────────────────────
async function alternarCamera() {
  modoCameraAtual = (modoCameraAtual === 'user') ? 'environment' : 'user';
  pararCamera();
  await iniciarCamera();
}

async function iniciarCamera() {
  const video = document.getElementById('video');
  const status = document.getElementById('camera-status');

  if (!navigator.mediaDevices?.getUserMedia) {
    status.innerHTML = '<i class="fas fa-lock text-warning"></i> HTTPS necessário para câmera';
    return;
  }

  try {
    try {
      streamCamera = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: modoCameraAtual,
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
    } catch (_) {
      // Fallback universal para compatibilidade com celulares e webcams simples
      streamCamera = await navigator.mediaDevices.getUserMedia({
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
    liberarBotoes(false); // Inicia bloqueado até o rosto ser reconhecido
    iniciarLoop();
  } catch (err) {
    console.error('Erro ao abrir câmera:', err);
    status.innerHTML = '<button onclick="iniciarCamera()" class="btn btn-sm btn-outline-danger" style="font-size:.75rem"><i class="fas fa-redo me-1"></i>Toque para ativar câmera</button>';
  }
}

function pararCamera() {
  loopAtivo = false;
  if (streamCamera) {
    streamCamera.getTracks().forEach(t => t.stop());
    streamCamera = null;
  }
  liberarBotoes(false);
}

// ─── Validação Facial Tolerante (Otimizada para Tablets & Baixa Resolução) ───
function validarEnquadramentoCompleto(deteccao, videoEl) {
  if (!deteccao || !deteccao.detection) {
    return { valido: false, motivo: 'Posicione seu rosto em frente à câmera' };
  }

  const score = deteccao.detection.score || 0;
  // Threshold permissivo (0.28) para permitir sensores com ruído e pouca luz de tablets
  if (score < 0.28) {
    return { valido: false, motivo: 'Ilumine o ambiente ou aproxime o rosto' };
  }

  // Verifica landmarks se disponíveis
  if (deteccao.landmarks) {
    const leftEye = deteccao.landmarks.getLeftEye();
    const rightEye = deteccao.landmarks.getRightEye();
    if (!leftEye.length || !rightEye.length) {
      return { valido: false, motivo: 'Mantenha os olhos voltados para a tela' };
    }
  }

  return { valido: true };
}

// ─── Loop de Reconhecimento Facial (Sem travar o processador do tablet) ───
// inputSize 320: 60% mais rápido em tablets e celulares que 416
// scoreThreshold 0.28: detecta rostos com baixa iluminação e câmeras simples
const opcoesDetector = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.28 });

function iniciarLoop() {
  loopAtivo = true;
  executarCicloReconhecimento();
}

async function executarCicloReconhecimento() {
  if (!loopAtivo) return;

  const video = document.getElementById('video');
  const moldura = document.getElementById('moldura-oval');
  const statusFace = document.getElementById('status-face');

  if (!streamCamera || !video || !video.videoWidth || processando || isAnalyzing) {
    if (loopAtivo) setTimeout(executarCicloReconhecimento, 160);
    return;
  }

  isAnalyzing = true;

  try {
    const deteccao = await faceapi
      .detectSingleFace(video, opcoesDetector)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!deteccao) {
      liberarBotoes(false);
      if (moldura) {
        moldura.classList.remove('reconhecido');
        moldura.classList.remove('nao-reconhecido');
      }
      statusFace.innerHTML = '<i class="fas fa-search text-warning me-1"></i>Posicione seu rosto em frente à câmera';
      statusFace.style.color = '#ffc107';
      return;
    }

    // 1. Checagem simples de enquadramento
    const validacao = validarEnquadramentoCompleto(deteccao, video);
    if (!validacao.valido) {
      liberarBotoes(false);
      if (moldura) {
        moldura.classList.remove('reconhecido');
        moldura.classList.remove('nao-reconhecido');
      }
      statusFace.innerHTML = `<i class="fas fa-exclamation-triangle text-warning me-1"></i>${validacao.motivo}`;
      statusFace.style.color = '#ffc107';
      return;
    }

    // 2. Validação biométrica neural com o colaborador do CPF
    if (funcionarioAtual && funcionarioAtual.faceDescriptor) {
      const distancia = faceapi.euclideanDistance(deteccao.descriptor, funcionarioAtual.faceDescriptor);

      // Limiar 0.58: padrão face-api.js para webcams reais e tablets com pouca luz
      if (distancia <= LIMIAR_SIMILARIDADE_PADRAO) {
        const confianca = Math.round(Math.max(65, Math.min(99, (1 - (distancia / 0.70)) * 100)));
        if (moldura) {
          moldura.classList.remove('nao-reconhecido');
          moldura.classList.add('reconhecido');
        }
        statusFace.innerHTML = `<i class="fas fa-check-circle text-success me-1"></i><strong>Rosto Identificado!</strong> (${confianca}%) — Toque no botão`;
        statusFace.style.color = '#28a745';
        liberarBotoes(true);
      } else {
        liberarBotoes(false);
        if (moldura) {
          moldura.classList.remove('reconhecido');
          moldura.classList.add('nao-reconhecido');
        }
        // Se a distância for próxima (ex: 0.59 a 0.68), sugere iluminação
        if (distancia <= 0.68) {
          statusFace.innerHTML = `<i class="fas fa-sun text-warning me-1"></i>Aproxime-se da luz para confirmar com ${funcionarioAtual.nome}`;
          statusFace.style.color = '#ffc107';
        } else {
          statusFace.innerHTML = `<i class="fas fa-times-circle text-danger me-1"></i><strong>Rosto não confere</strong> com ${funcionarioAtual.nome}`;
          statusFace.style.color = '#dc3545';
        }
      }
    } else {
      if (moldura) moldura.classList.add('reconhecido');
      statusFace.innerHTML = `<i class="fas fa-check-circle text-success me-1"></i>Rosto Enquadrado! Toque no botão desejado`;
      statusFace.style.color = '#28a745';
      liberarBotoes(true);
    }

  } catch (e) {
    console.warn('Loop facial:', e);
  } finally {
    isAnalyzing = false;
    if (loopAtivo) setTimeout(executarCicloReconhecimento, 160);
  }
}

function liberarBotoes(liberar) {
  faceReconhecida = !!liberar;
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

// ─── Registrar Ponto ──────────────────────────────────
async function registrarPonto(tipo) {
  if (processando || !funcionarioAtual) return;

  // Trava de segurança: impede bater sem rosto reconhecido
  if (!faceReconhecida) {
    abrirOverlayErro("Acesso Negado: Rosto não identificado. Posicione seu rosto na moldura da câmera para registrar o ponto.");
    return;
  }

  processando = true;
  liberarBotoes(false);

  // Abre na tela o modal destacado "Registrando ponto..."
  abrirOverlayProcessando();

  const video = document.getElementById('video');
  let confianca = 92;
  let fotoSnapshot = null;

  try {
    // 1. Tira foto da câmera e faz a validação facial rigorosa
    if (video && video.videoWidth) {
      const capCanvas = document.createElement('canvas');
      capCanvas.width = 320;
      capCanvas.height = 240;
      const capCtx = capCanvas.getContext('2d');
      capCtx.drawImage(video, 0, 0, 320, 240);
      fotoSnapshot = capCanvas.toDataURL('image/jpeg', 0.7);

      // Verificação biométrica instantânea no momento da batida (otimizada para tablets)
      const det = await faceapi
        .detectSingleFace(video, opcoesDetector)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (det && det.descriptor && funcionarioAtual.faceDescriptor) {
        const d = faceapi.euclideanDistance(det.descriptor, funcionarioAtual.faceDescriptor);
        if (d > (LIMIAR_SIMILARIDADE_PADRAO + 0.04) && !faceReconhecida) {
          abrirOverlayErro(`Biometria não confirmada! O rosto na câmera não confere com o cadastro de ${funcionarioAtual.nome}.`);
          return;
        }
        confianca = Math.round(Math.max(65, Math.min(99, (1 - (d / 0.70)) * 100)));
      }
    } else {
      abrirOverlayErro("Câmera indisponível. É obrigatório o reconhecimento facial para bater o ponto.");
      return;
    }

    const agora = firebase.firestore.Timestamp.now();
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeMs = hoje.getTime();

    // 2. Verifica duplicidade no dia (sem índice composto)
    const snap = await db.collection('registros')
      .where('cpf', '==', funcionarioAtual.cpf)
      .get();

    const jaRegistrou = snap.docs.find(doc => {
      const d = doc.data();
      const dt = d.timestamp?.toDate ? d.timestamp.toDate().getTime() : 0;
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
      const horaExist = jaRegistrou.data().timestamp?.toDate ? jaRegistrou.data().timestamp.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '';
      abrirOverlayErro(`${funcionarioAtual.nome} já registrou "${TIPOS[tipo]}" hoje${horaExist ? ' às ' + horaExist : ''}.`);
      return;
    }

    // 3. Salva no Firestore
    const registroDoc = {
      cpf: funcionarioAtual.cpf,
      funcionarioId: funcionarioAtual.id,
      funcionarioNome: funcionarioAtual.nome,
      cargo: funcionarioAtual.cargo,
      departamento: funcionarioAtual.departamento,
      tipo: tipo,
      tipoLabel: TIPOS[tipo],
      timestamp: agora,
      confianca: confianca,
      fotoSnapshot: fotoSnapshot
    };

    await db.collection('registros').add(registroDoc);
    console.log('✅ Ponto salvo com sucesso no Firestore!');

    const horaFormatada = agora.toDate().toLocaleTimeString('pt-BR');
    abrirOverlaySucesso(funcionarioAtual.nome, TIPOS[tipo], horaFormatada, fotoSnapshot || funcionarioAtual.fotoUrl);

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

function mostrarSucesso(nome, cargo, tipo, confianca, data, foto) {
  document.getElementById('res-icone').innerHTML = foto 
    ? `<img src="${foto}" style="width:60px;height:60px;border-radius:50%;object-fit:cover;border:3px solid var(--success)">`
    : '<i class="fas fa-check-circle text-success"></i>';
  document.getElementById('res-nome').textContent = nome;
  document.getElementById('res-cargo').textContent = cargo;
  document.getElementById('res-tipo').innerHTML = `<span class="badge-tipo badge-${tipo}">${TIPOS[tipo]}</span>`;
  document.getElementById('res-hora').innerHTML = `<i class="fas fa-clock me-1"></i>${data.toLocaleString('pt-BR')}`;
  document.getElementById('res-conf').innerHTML = confianca ? `<i class="fas fa-fingerprint me-1"></i>Biometria: ${confianca}%` : '';
  document.getElementById('res-msg').innerHTML = `<strong class="text-success fs-5">Ponto registrado com sucesso!</strong><br>Olá, ${nome}! Tenha um ótimo trabalho.`;
  
  const card = document.getElementById('card-resultado');
  card.classList.add('visivel','sucesso');

  // Contador regressivo visível de 5 segundos
  let segundos = 5;
  const contadorBox = document.getElementById('res-contador');
  const contadorNum = document.getElementById('segundos-restantes');
  if (contadorBox && contadorNum) {
    contadorBox.classList.remove('d-none');
    contadorNum.textContent = segundos;
  }

  if (timerContagem) clearInterval(timerContagem);
  timerContagem = setInterval(() => {
    segundos--;
    if (contadorNum) contadorNum.textContent = segundos;
    if (segundos <= 0) {
      clearInterval(timerContagem);
      timerContagem = null;
      voltarCPF();
    }
  }, 1000);
}

function mostrarErro(msg) {
  document.getElementById('res-icone').innerHTML = '<i class="fas fa-times-circle text-danger"></i>';
  document.getElementById('res-nome').textContent = 'Atenção';
  document.getElementById('res-cargo').textContent = '';
  document.getElementById('res-tipo').textContent = '';
  document.getElementById('res-hora').textContent = '';
  document.getElementById('res-conf').textContent = '';
  document.getElementById('res-msg').textContent = msg;
  const card = document.getElementById('card-resultado');
  card.classList.add('visivel','erro');
  liberarBotoes(faceReconhecida);
  processando = false;
}

// ─── Feed de registros ────────────────────────────────
async function carregarFeed() {
  const lista = document.getElementById('feed-lista');
  if (!lista || !db) return;
  try {
    const snap = await db.collection('registros')
      .orderBy('timestamp', 'desc')
      .limit(20)
      .get();

    if (snap.empty) {
      lista.innerHTML = '<div class="text-muted text-center py-3" style="font-size:.85rem">Nenhum registro ainda</div>';
      return;
    }

    const icones = {
      entrada:         'fas fa-sign-in-alt text-success',
      almoco_saida:    'fas fa-utensils text-warning',
      almoco_retorno:  'fas fa-undo text-info',
      saida_extra:     'fas fa-door-open text-warning',
      retorno_extra:   'fas fa-walking text-info',
      saida:           'fas fa-sign-out-alt text-danger'
    };

    lista.innerHTML = snap.docs.map(d => {
      const r = d.data();
      const hora = r.timestamp?.toDate().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) || '--:--';
      const data = r.timestamp?.toDate().toLocaleDateString('pt-BR') || '';
      return `<div class="feed-item">
        <div>
          <div class="feed-nome">${r.funcionarioNome}</div>
          <div class="feed-detalhe"><i class="${icones[r.tipo] || 'fas fa-clock'}"></i> ${TIPOS[r.tipo] || r.tipo}</div>
        </div>
        <div class="feed-hora">${hora}<br><small>${data}</small></div>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('Erro ao carregar feed:', e);
  }
}

// Previne zoom indesejado de duplo clique no Safari / Chrome Mobile
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
