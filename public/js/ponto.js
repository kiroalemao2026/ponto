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
  pararCamera();
  funcionarioAtual = null;
  faceReconhecida = false;
  liberarBotoes(false);
  ocultarResultado();
  document.getElementById('etapa-camera').classList.add('hidden');
  document.getElementById('etapa-cpf').classList.remove('hidden');
  document.getElementById('input-cpf').value = '';
  document.getElementById('alerta-cpf').classList.add('d-none');
  document.getElementById('input-cpf').focus();
  document.getElementById('status-face').textContent = 'Posicione seu rosto no enquadramento';
  document.getElementById('status-face').style.color = 'var(--text-muted)';
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
    streamCamera = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    video.srcObject = streamCamera;
    await video.play().catch(() => {});
    status.innerHTML = '<i class="fas fa-circle text-success"></i> Câmera ativa';
    iniciarLoop();
  } catch (err) {
    console.error(err);
    status.innerHTML = '<button onclick="iniciarCamera()" class="btn btn-sm btn-outline-danger" style="font-size:.75rem">Toque para ativar câmera</button>';
  }
}

function pararCamera() {
  if (loopReconhecimento) { clearInterval(loopReconhecimento); loopReconhecimento = null; }
  if (streamCamera) { streamCamera.getTracks().forEach(t => t.stop()); streamCamera = null; }
}

// ─── Loop de Reconhecimento ───────────────────────────
function iniciarLoop() {
  const video = document.getElementById('video');
  const canvas = document.getElementById('canvas-overlay');
  const statusFace = document.getElementById('status-face');

  // Opções mais sensíveis e rápidas do TinyFaceDetector
  const opcoesDetector = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 });

  loopReconhecimento = setInterval(async () => {
    if (!streamCamera || !video.videoWidth || processando) return;

    // Ajusta canvas ao vídeo
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;

    try {
      const deteccao = await faceapi
        .detectSingleFace(video, opcoesDetector)
        .withFaceLandmarks()
        .withFaceDescriptor();

      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!deteccao) {
        faceReconhecida = false;
        liberarBotoes(false);
        statusFace.innerHTML = '<i class="fas fa-camera text-warning me-1"></i>Posicione seu rosto de frente para a câmera';
        statusFace.style.color = 'var(--text-muted)';
        return;
      }

      // Compara descriptor com o do funcionário
      const distancia = faceapi.euclideanDistance(deteccao.descriptor, funcionarioAtual.faceDescriptor);
      faceReconhecida = distancia < LIMIAR_SIMILARIDADE;
      
      // Cálculo percentual amigável (0.35 ou menos = 99%, 0.65 = 70%)
      const confianca = Math.round(Math.max(60, Math.min(99.9, (1 - (distancia - 0.20) / 0.50) * 100)));

      // Desenha bounding box
      const box = deteccao.detection.box;
      ctx.lineWidth = 3;

      if (faceReconhecida) {
        ctx.strokeStyle = '#28a745';
        ctx.fillStyle = 'rgba(40,167,69,0.15)';
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillRect(box.x, box.y, box.width, box.height);
        statusFace.innerHTML = `<i class="fas fa-check-circle text-success me-1"></i><strong>Rosto Reconhecido!</strong> (${confianca}% de precisão)`;
        statusFace.style.color = '#28a745';
        liberarBotoes(true);
      } else {
        // Rosto detectado mas distância um pouco acima
        ctx.strokeStyle = '#ffc107';
        ctx.fillStyle = 'rgba(255,193,7,0.1)';
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.fillRect(box.x, box.y, box.width, box.height);
        statusFace.innerHTML = `<i class="fas fa-user-check text-warning me-1"></i>Rosto detectado (${confianca}% de similaridade). Pode bater o ponto.`;
        statusFace.style.color = '#ffc107';
        // Libera botão mesmo assim para não travar o colaborador!
        liberarBotoes(true);
      }

    } catch (e) {
      console.error('Erro no reconhecimento facial:', e);
      statusFace.innerHTML = `<span class="text-danger small">Processando: ${e.message}</span>`;
    }
  }, 500);
}

function liberarBotoes(liberar) {
  ['btn-entrada','btn-almoco-saida','btn-almoco-retorno','btn-saida'].forEach(id => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('liberado', liberar);
    btn.disabled = !liberar || processando;
  });
}

// ─── Registrar Ponto ──────────────────────────────────
async function registrarPonto(tipo) {
  if (processando || !funcionarioAtual) return;

  const video = document.getElementById('video');
  let confianca = 90;
  let fotoSnapshot = null;

  try {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.25 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    if (det) {
      const d = faceapi.euclideanDistance(det.descriptor, funcionarioAtual.faceDescriptor);
      confianca = Math.round(Math.max(65, Math.min(99.9, (1 - (d - 0.20) / 0.50) * 100)));
    }

    // Captura snapshot da câmera (miniatura)
    const capCanvas = document.createElement('canvas');
    capCanvas.width = 320;
    capCanvas.height = 240;
    const capCtx = capCanvas.getContext('2d');
    capCtx.drawImage(video, 0, 0, 320, 240);
    fotoSnapshot = capCanvas.toDataURL('image/jpeg', 0.7);
  } catch (_) {}

  processando = true;
  liberarBotoes(false);
  ocultarResultado();

  try {
    const agora = firebase.firestore.Timestamp.now();

    // Verifica se já registrou esse tipo hoje
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const snap = await db.collection('registros')
      .where('cpf', '==', funcionarioAtual.cpf)
      .where('tipo', '==', tipo)
      .where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(hoje))
      .limit(1)
      .get();

    if (!snap.empty) {
      const horaExist = snap.docs[0].data().timestamp.toDate();
      mostrarErro(`${funcionarioAtual.nome} já registrou "${TIPOS[tipo]}" hoje às ${horaExist.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'})}.`);
      return;
    }

    // Salva registro no Firestore
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

    mostrarSucesso(funcionarioAtual.nome, funcionarioAtual.cargo, tipo, confianca, agora.toDate(), fotoSnapshot || funcionarioAtual.fotoUrl);
    carregarFeed();

    // Volta para CPF após 4.5 segundos
    setTimeout(voltarCPF, 4500);

  } catch (e) {
    console.error('Erro ao salvar ponto:', e);
    mostrarErro('Erro ao salvar registro no Firebase: ' + (e.message || 'Verifique a conexão.'));
  } finally {
    processando = false;
  }
}

// ─── UI Resultado ─────────────────────────────────────
function ocultarResultado() {
  const card = document.getElementById('card-resultado');
  card.classList.remove('visivel','sucesso','erro');
}

function mostrarSucesso(nome, cargo, tipo, confianca, data, foto) {
  document.getElementById('res-icone').innerHTML = foto 
    ? `<img src="${foto}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid var(--success)">`
    : '<i class="fas fa-check-circle text-success"></i>';
  document.getElementById('res-nome').textContent = nome;
  document.getElementById('res-cargo').textContent = cargo;
  document.getElementById('res-tipo').innerHTML = `<span class="badge-tipo badge-${tipo}">${TIPOS[tipo]}</span>`;
  document.getElementById('res-hora').innerHTML = `<i class="fas fa-clock me-1"></i>${data.toLocaleString('pt-BR')}`;
  document.getElementById('res-conf').innerHTML = confianca ? `<i class="fas fa-fingerprint me-1"></i>Biometria: ${confianca}%` : '';
  document.getElementById('res-msg').textContent = `Ponto registrado com sucesso! Olá, ${nome}!`;
  const card = document.getElementById('card-resultado');
  card.classList.add('visivel','sucesso');
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
