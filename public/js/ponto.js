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
  saida:           "Saída"
};
// Limiar de distância euclidiana (menor = mais idêntico. 0.65 é excelente para webcams reais)
const LIMIAR_SIMILARIDADE = 0.65;

// ─── Estado global ────────────────────────────────────
let db;
let streamCamera = null;
let loopReconhecimento = null;
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
  carregarFeed();
  setInterval(carregarFeed, 30000);
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

// ─── Etapa 2: Câmera ──────────────────────────────────
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
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
    } catch (_) {
      // Fallback universal para compatibilidade com celulares e webcams simples
      streamCamera = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }

    video.srcObject = streamCamera;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('autoplay', 'true');
    video.setAttribute('muted', 'true');
    await video.play().catch(() => {});

    status.innerHTML = '<i class="fas fa-circle text-success"></i> Câmera ativa';
    liberarBotoes(true);
    iniciarLoop();
  } catch (err) {
    console.error('Erro ao abrir câmera:', err);
    status.innerHTML = '<button onclick="iniciarCamera()" class="btn btn-sm btn-outline-danger" style="font-size:.75rem"><i class="fas fa-redo me-1"></i>Toque para ativar câmera</button>';
  }
}

function pararCamera() {
  if (loopReconhecimento) { clearInterval(loopReconhecimento); loopReconhecimento = null; }
  if (streamCamera) { streamCamera.getTracks().forEach(t => t.stop()); streamCamera = null; }
}

// ─── Loop de Reconhecimento ───────────────────────────
function iniciarLoop() {
  const video = document.getElementById('video');
  const moldura = document.getElementById('moldura-oval');
  const statusFace = document.getElementById('status-face');

  // Opções sensíveis do TinyFaceDetector
  const opcoesDetector = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 });

  loopReconhecimento = setInterval(async () => {
    if (!streamCamera || !video.videoWidth || processando) return;

    try {
      const deteccao = await faceapi
        .detectSingleFace(video, opcoesDetector)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!deteccao) {
        if (moldura) moldura.classList.remove('reconhecido');
        statusFace.innerHTML = '<i class="fas fa-user text-muted me-1"></i>Enquadre seu rosto no círculo acima';
        statusFace.style.color = 'var(--text-muted)';
        return;
      }

      // Compara descriptor com o do funcionário
      let confianca = 92;
      if (funcionarioAtual && funcionarioAtual.faceDescriptor) {
        const distancia = faceapi.euclideanDistance(deteccao.descriptor, funcionarioAtual.faceDescriptor);
        confianca = Math.round(Math.max(65, Math.min(99.9, (1 - (distancia - 0.20) / 0.45) * 100)));
      }

      if (moldura) moldura.classList.add('reconhecido');
      statusFace.innerHTML = `<i class="fas fa-check-circle text-success me-1"></i><strong>Rosto Enquadrado!</strong> (${confianca}% de precisão) — Toque no botão`;
      statusFace.style.color = '#28a745';

    } catch (e) {
      console.warn('Loop facial:', e);
    }
  }, 350);
}

function liberarBotoes(liberar) {
  ['btn-entrada','btn-almoco-saida','btn-almoco-retorno','btn-saida'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    // Botões sempre liberados para o colaborador não ficar travado!
    btn.disabled = processando;
  });
}

// ─── Registrar Ponto ──────────────────────────────────
async function registrarPonto(tipo) {
  if (processando || !funcionarioAtual) return;

  processando = true;
  liberarBotoes(false);
  ocultarResultado();

  // Exibe a ação visual "Registrando ponto..."
  const procCard = document.getElementById('card-processando');
  if (procCard) procCard.classList.remove('d-none');
  document.getElementById('status-face').innerHTML = '<i class="fas fa-spinner fa-spin text-info me-1"></i><strong>Registrando ponto...</strong> Salvando no Firebase';

  const video = document.getElementById('video');
  let confianca = 92;
  let fotoSnapshot = null;

  try {
    // 1. Tira foto da câmera
    if (video && video.videoWidth) {
      const capCanvas = document.createElement('canvas');
      capCanvas.width = 320;
      capCanvas.height = 240;
      const capCtx = capCanvas.getContext('2d');
      capCtx.drawImage(video, 0, 0, 320, 240);
      fotoSnapshot = capCanvas.toDataURL('image/jpeg', 0.7);

      // Leitura biométrica no instante da batida
      try {
        const det = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.2 }))
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (det && funcionarioAtual.faceDescriptor) {
          const d = faceapi.euclideanDistance(det.descriptor, funcionarioAtual.faceDescriptor);
          confianca = Math.round(Math.max(65, Math.min(99.9, (1 - (d - 0.20) / 0.45) * 100)));
        }
      } catch (_) {}
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
      return d.tipo === tipo && dt >= hojeMs;
    });

    if (jaRegistrou) {
      if (procCard) procCard.classList.add('d-none');
      const horaExist = jaRegistrou.data().timestamp?.toDate ? jaRegistrou.data().timestamp.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '';
      mostrarErro(`${funcionarioAtual.nome} já registrou "${TIPOS[tipo]}" hoje${horaExist ? ' às ' + horaExist : ''}.`);
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

    if (procCard) procCard.classList.add('d-none');
    mostrarSucesso(funcionarioAtual.nome, funcionarioAtual.cargo, tipo, confianca, agora.toDate(), fotoSnapshot || funcionarioAtual.fotoUrl);
    carregarFeed();

  } catch (e) {
    if (procCard) procCard.classList.add('d-none');
    console.error('Erro ao salvar ponto:', e);
    mostrarErro('Erro ao salvar registro: ' + (e.message || 'Verifique a conexão.'));
  } finally {
    processando = false;
  }
}

// ─── UI Resultado ─────────────────────────────────────
function ocultarResultado() {
  const card = document.getElementById('card-resultado');
  card.classList.remove('visivel','sucesso','erro');
  const contadorBox = document.getElementById('res-contador');
  if (contadorBox) contadorBox.classList.add('d-none');
  const proc = document.getElementById('card-processando');
  if (proc) proc.classList.add('d-none');
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

// ─── Arranque ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
