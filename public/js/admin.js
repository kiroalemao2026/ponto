// ============================================================
//  admin.js — Lógica do Painel de Administração
//  Firebase Firestore + face-api.js
// ============================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBCuPyOvWhv0MVz6S-Cd8bFDgBcyF1ZCY4",
  authDomain: "ponto-mobilitta.firebaseapp.com",
  projectId: "ponto-mobilitta",
  storageBucket: "ponto-mobilitta.firebasestorage.app",
  messagingSenderId: "217323535686",
  appId: "1:217323535686:web:6c583a7ba09d64594db947"
};

const TIPOS_LABEL = {
  entrada: "Entrada",
  almoco_saida: "Saída Almoço",
  almoco_retorno: "Retorno Almoço",
  saida: "Saída"
};

let db, auth;
let streamAdminCam = null;
let listaFuncionariosCache = [];
let listaRegistrosCache = [];
let modalFuncInstancia = null;
let modalFotoInstancia = null;

// ─── Inicialização ────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Verifica autenticação simples
  if (!sessionStorage.getItem('admin_logado')) {
    window.location.href = '/login.html';
    return;
  }

  firebase.initializeApp(FIREBASE_CONFIG);
  db = firebase.firestore();
  auth = firebase.auth();

  modalFuncInstancia = new bootstrap.Modal(document.getElementById('modal-func'));
  modalFotoInstancia = new bootstrap.Modal(document.getElementById('modal-foto'));

  // Data atual
  const agora = new Date();
  document.getElementById('dash-data-atual').textContent = agora.toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  const mesAtualInput = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  document.getElementById('select-relatorio-mes').value = mesAtualInput;

  // Carrega modelos face-api em segundo plano
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models')
    ]);
  } catch (e) {
    console.warn('Erro ao carregar modelos locais, tentando CDN:', e);
    try {
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'),
        faceapi.nets.faceLandmark68Net.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights'),
        faceapi.nets.faceRecognitionNet.loadFromUri('https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@0.22.2/weights')
      ]);
    } catch (err) {
      console.error('Falha geral ao carregar modelos face-api:', err);
    }
  }

  // Carrega dados iniciais
  carregarDadosGerais();
});

// ─── Navegação entre Abas ─────────────────────────────
function navegarAba(aba, el) {
  document.querySelectorAll('.aba-secao').forEach(sec => sec.classList.add('d-none'));
  document.querySelectorAll('.nav-item-link').forEach(link => link.classList.remove('ativo'));

  document.getElementById(`aba-${aba}`).classList.remove('d-none');
  el.classList.add('ativo');

  if (aba === 'dashboard') carregarDadosGerais();
  if (aba === 'funcionarios') carregarFuncionarios();
  if (aba === 'registros') carregarRegistros();
  if (aba === 'relatorios') carregarOpcoesRelatorio();
}

function fazerLogout() {
  sessionStorage.removeItem('admin_logado');
  sessionStorage.removeItem('admin_email');
  if (auth) auth.signOut();
  window.location.href = '/login.html';
}

// ─── Dashboard & Métricas ─────────────────────────────
async function carregarDadosGerais() {
  try {
    // 1. Total funcionários
    const snapFunc = await db.collection('funcionarios').get();
    listaFuncionariosCache = snapFunc.docs.map(d => ({ id: d.id, ...d.data() }));

    const totalAtivos = listaFuncionariosCache.filter(f => f.ativo !== false).length;
    document.getElementById('dash-total-func').textContent = totalAtivos;

    // 2. Todos os Registros do Firestore (sem exigência de índice)
    const snapReg = await db.collection('registros').get();
    let todosRegistros = snapReg.docs.map(d => ({ id: d.id, ...d.data() }));

    // Ordena do mais recente para o mais antigo em memória
    todosRegistros.sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return tb - ta;
    });

    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const inicioHojeMs = inicioHoje.getTime();

    const registrosHoje = todosRegistros.filter(r => {
      const dt = r.timestamp?.toDate ? r.timestamp.toDate().getTime() : (r.timestamp?.seconds ? r.timestamp.seconds * 1000 : 0);
      return dt >= inicioHojeMs;
    });

    document.getElementById('dash-batidas-hoje').textContent = registrosHoje.length;

    // Presentes (que bateram entrada hoje)
    const cpfsPresentes = new Set(registrosHoje.filter(r => r.tipo === 'entrada').map(r => r.cpf));
    document.getElementById('dash-presentes').textContent = cpfsPresentes.size;
    document.getElementById('dash-ausentes').textContent = Math.max(0, totalAtivos - cpfsPresentes.size);

    // 3. Tabela de últimos registros
    const tbody = document.getElementById('tabela-dash-ultimos');
    if (todosRegistros.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Nenhum registro encontrado ainda.</td></tr>';
      return;
    }

    const ultimos10 = todosRegistros.slice(0, 10);
    tbody.innerHTML = ultimos10.map(r => {
      const dataHora = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString('pt-BR') : '--';
      const foto = r.fotoSnapshot || '';
      return `
        <tr>
          <td><i class="fas fa-clock text-muted me-1"></i> ${dataHora}</td>
          <td><strong class="text-light">${r.funcionarioNome || 'Desconhecido'}</strong></td>
          <td>${r.cargo || ''} <small class="text-muted">${r.departamento ? '· ' + r.departamento : ''}</small></td>
          <td><span class="badge-tipo badge-${r.tipo}">${TIPOS_LABEL[r.tipo] || r.tipo}</span></td>
          <td><i class="fas fa-fingerprint text-accent me-1"></i> ${r.confianca || 95}%</td>
          <td>
            ${foto 
              ? `<img src="${foto}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;cursor:pointer;" onclick="verFotoAmpliada('${foto}', '${r.funcionarioNome} - ${dataHora}')">` 
              : '<span class="text-muted small">Sem foto</span>'}
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Erro ao carregar dados gerais:', err);
  }
}

// ─── Gestão de Funcionários ───────────────────────────
async function carregarFuncionarios() {
  const tbody = document.getElementById('tabela-funcionarios');
  tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Carregando colaboradores...</td></tr>';

  try {
    const snap = await db.collection('funcionarios').get();
    listaFuncionariosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderizarTabelaFuncionarios(listaFuncionariosCache);
  } catch (err) {
    console.error('Erro ao listar funcionários:', err);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger">Erro ao carregar do Firestore: ${err.message}</td></tr>`;
  }
}

function renderizarTabelaFuncionarios(lista) {
  const tbody = document.getElementById('tabela-funcionarios');
  if (lista.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Nenhum funcionário cadastrado.</td></tr>';
    return;
  }

  tbody.innerHTML = lista.map(f => {
    const temBiometria = f.faceDescriptor && f.faceDescriptor.length > 0;
    const ativo = f.ativo !== false;
    const foto = f.fotoUrl || '';

    return `
      <tr>
        <td>
          ${foto 
            ? `<img src="${foto}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;" onclick="verFotoAmpliada('${foto}', '${f.nome}')">`
            : '<div style="width:40px;height:40px;border-radius:50%;background:#30363d;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user text-muted"></i></div>'}
        </td>
        <td><strong class="text-light">${f.nome}</strong></td>
        <td><code>${formatarCPF(f.cpf || '')}</code></td>
        <td>${f.cargo || '-'} <small class="text-muted">${f.departamento ? '· ' + f.departamento : ''}</small></td>
        <td>
          ${temBiometria 
            ? '<span class="badge bg-success"><i class="fas fa-check-circle me-1"></i>Ativa (128D)</span>' 
            : '<span class="badge bg-danger"><i class="fas fa-times-circle me-1"></i>Pendente</span>'}
        </td>
        <td>
          <span class="badge ${ativo ? 'bg-primary' : 'bg-secondary'}">${ativo ? 'Ativo' : 'Inativo'}</span>
        </td>
        <td>
          <button class="btn btn-sm btn-outline-light me-1" onclick="editarFuncionario('${f.id}')" title="Editar">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="excluirFuncionario('${f.id}', '${f.nome}')" title="Excluir">
            <i class="fas fa-trash-alt"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function filtrarFuncionarios() {
  const termo = document.getElementById('filtro-func-busca').value.toLowerCase().replace(/\D/g, '') || document.getElementById('filtro-func-busca').value.toLowerCase();
  const filtrados = listaFuncionariosCache.filter(f => {
    const nomeMatch = (f.nome || '').toLowerCase().includes(termo);
    const cpfMatch = (f.cpf || '').includes(termo);
    return nomeMatch || cpfMatch;
  });
  renderizarTabelaFuncionarios(filtrados);
}

// ─── Modal de Funcionário (Cadastrar / Editar) ─────────
function abrirModalFuncionario() {
  document.getElementById('form-salvar-func').reset();
  document.getElementById('func-id').value = '';
  document.getElementById('func-foto-base64').value = '';
  document.getElementById('func-face-descriptor').value = '';
  document.getElementById('modal-func-titulo').innerHTML = '<i class="fas fa-user-plus text-accent me-2"></i>Cadastrar Colaborador';
  document.getElementById('img-preview-func').style.display = 'none';
  document.getElementById('status-biometria').innerHTML = 'Nenhuma biometria cadastrada ainda.';
  document.getElementById('status-biometria').className = 'small text-muted';
  fecharCameraAdmin();

  modalFuncInstancia.show();
}

function editarFuncionario(id) {
  const f = listaFuncionariosCache.find(item => item.id === id);
  if (!f) return;

  document.getElementById('func-id').value = f.id;
  document.getElementById('func-nome').value = f.nome || '';
  document.getElementById('func-cpf').value = formatarCPF(f.cpf || '');
  document.getElementById('func-cargo').value = f.cargo || '';
  document.getElementById('func-departamento').value = f.departamento || '';
  document.getElementById('func-email').value = f.email || '';
  document.getElementById('func-ativo').value = f.ativo !== false ? 'true' : 'false';

  document.getElementById('func-foto-base64').value = f.fotoUrl || '';
  document.getElementById('func-face-descriptor').value = f.faceDescriptor ? JSON.stringify(f.faceDescriptor) : '';

  const img = document.getElementById('img-preview-func');
  if (f.fotoUrl) {
    img.src = f.fotoUrl;
    img.style.display = 'block';
  } else {
    img.style.display = 'none';
  }

  if (f.faceDescriptor && f.faceDescriptor.length > 0) {
    document.getElementById('status-biometria').innerHTML = '<i class="fas fa-check-circle text-success me-1"></i>Biometria cadastrada e válida.';
    document.getElementById('status-biometria').className = 'small text-success';
  } else {
    document.getElementById('status-biometria').innerHTML = 'Biometria pendente. Capture uma nova foto.';
    document.getElementById('status-biometria').className = 'small text-warning';
  }

  document.getElementById('modal-func-titulo').innerHTML = '<i class="fas fa-user-edit text-accent me-2"></i>Editar Colaborador';
  fecharCameraAdmin();
  modalFuncInstancia.show();
}

// Câmera ao vivo dentro do Modal Admin
async function iniciarCameraAdmin() {
  const wrapper = document.getElementById('wrapper-cam-admin');
  const video = document.getElementById('video-cam-admin');
  wrapper.classList.remove('d-none');

  try {
    streamAdminCam = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: 'user' },
      audio: false
    });
    video.srcObject = streamAdminCam;
    await video.play();
  } catch (err) {
    alert('Não foi possível acessar a câmera: ' + err.message);
  }
}

function fecharCameraAdmin() {
  if (streamAdminCam) {
    streamAdminCam.getTracks().forEach(t => t.stop());
    streamAdminCam = null;
  }
  const wrapper = document.getElementById('wrapper-cam-admin');
  if (wrapper) wrapper.classList.add('d-none');
}

async function capturarFotoCamAdmin() {
  const video = document.getElementById('video-cam-admin');
  if (!video.videoWidth) return;

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  const fotoBase64 = canvas.toDataURL('image/jpeg', 0.85);
  fecharCameraAdmin();

  await processarFotoBiometria(fotoBase64);
}

function carregarFotoArquivo(input) {
  if (!input.files || !input.files[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    await processarFotoBiometria(e.target.result);
  };
  reader.readAsDataURL(file);
}

async function processarFotoBiometria(fotoBase64) {
  const statusEl = document.getElementById('status-biometria');
  const spinner = document.getElementById('spinner-biometria');
  const previewImg = document.getElementById('img-preview-func');

  previewImg.src = fotoBase64;
  previewImg.style.display = 'block';

  statusEl.textContent = 'Processando rede neural facial...';
  statusEl.className = 'small text-info';
  spinner.classList.remove('d-none');

  try {
    const imgElement = await faceapi.fetchImage(fotoBase64);
    const deteccao = await faceapi
      .detectSingleFace(imgElement, new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptor();

    spinner.classList.add('d-none');

    if (!deteccao) {
      statusEl.innerHTML = '<i class="fas fa-exclamation-triangle text-danger me-1"></i>Nenhum rosto detectado na foto. Tente outra com melhor iluminação.';
      statusEl.className = 'small text-danger';
      document.getElementById('func-face-descriptor').value = '';
      return;
    }

    // Vetor de 128 dimensões
    const descriptorArray = Array.from(deteccao.descriptor);
    document.getElementById('func-foto-base64').value = fotoBase64;
    document.getElementById('func-face-descriptor').value = JSON.stringify(descriptorArray);

    statusEl.innerHTML = '<i class="fas fa-check-circle text-success me-1"></i>Rosto detectado com sucesso! Biometria neural 128D gerada.';
    statusEl.className = 'small text-success';

  } catch (err) {
    spinner.classList.add('d-none');
    console.error('Erro na extração facial:', err);
    statusEl.innerHTML = '<i class="fas fa-times-circle text-danger me-1"></i>Erro ao gerar biometria: ' + err.message;
    statusEl.className = 'small text-danger';
  }
}

// Salvar no Firestore
async function salvarFuncionario(e) {
  e.preventDefault();

  const id = document.getElementById('func-id').value;
  const nome = document.getElementById('func-nome').value.trim();
  const cpfLimpo = document.getElementById('func-cpf').value.replace(/\D/g, '');
  const cargo = document.getElementById('func-cargo').value.trim();
  const departamento = document.getElementById('func-departamento').value.trim();
  const email = document.getElementById('func-email').value.trim();
  const ativo = document.getElementById('func-ativo').value === 'true';

  const fotoUrl = document.getElementById('func-foto-base64').value;
  const descriptorStr = document.getElementById('func-face-descriptor').value;
  let faceDescriptor = null;

  if (descriptorStr) {
    try {
      faceDescriptor = JSON.parse(descriptorStr);
    } catch (_) {}
  }

  if (cpfLimpo.length !== 11) {
    alert('O CPF deve ter exatamente 11 dígitos.');
    return;
  }

  const btn = document.getElementById('btn-salvar-modal');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Salvando no Firebase...';

  try {
    const dados = {
      nome: nome,
      cpf: cpfLimpo,
      cargo: cargo,
      departamento: departamento,
      email: email,
      ativo: ativo
    };

    if (fotoUrl) dados.fotoUrl = fotoUrl;
    if (faceDescriptor) dados.faceDescriptor = faceDescriptor;

    if (id) {
      // Atualizar existente
      dados.dataAtualizacao = Date.now();
      await db.collection('funcionarios').doc(id).update(dados);
    } else {
      // Criar novo
      dados.dataCadastro = Date.now();
      await db.collection('funcionarios').add(dados);
    }

    fecharCameraAdmin();
    modalFuncInstancia.hide();
    carregarFuncionarios();
    alert('Colaborador salvo com sucesso no Firestore!');

  } catch (err) {
    console.error('Erro ao salvar funcionário:', err);
    alert('Erro ao salvar no Firestore: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-save me-1"></i> Salvar Colaborador';
  }
}

async function excluirFuncionario(id, nome) {
  if (!confirm(`Deseja realmente desativar o colaborador "${nome}"?`)) return;

  try {
    await db.collection('funcionarios').doc(id).update({ ativo: false });
    carregarFuncionarios();
  } catch (err) {
    alert('Erro ao desativar: ' + err.message);
  }
}

// ─── Registros de Ponto ───────────────────────────────
async function carregarRegistros() {
  const tbody = document.getElementById('tabela-todos-registros');
  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Carregando histórico do Firebase...</td></tr>';

  try {
    const snap = await db.collection('registros').get();
    let lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Ordena do mais recente para o mais antigo em memória
    lista.sort((a, b) => {
      const ta = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const tb = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return tb - ta;
    });

    const dtInicio = document.getElementById('filtro-data-inicio').value;
    const dtFim = document.getElementById('filtro-data-fim').value;

    if (dtInicio) {
      const inicioMs = new Date(dtInicio + 'T00:00:00').getTime();
      lista = lista.filter(r => {
        const t = r.timestamp?.toDate ? r.timestamp.toDate().getTime() : (r.timestamp?.seconds ? r.timestamp.seconds * 1000 : 0);
        return t >= inicioMs;
      });
    }
    if (dtFim) {
      const fimMs = new Date(dtFim + 'T23:59:59').getTime();
      lista = lista.filter(r => {
        const t = r.timestamp?.toDate ? r.timestamp.toDate().getTime() : (r.timestamp?.seconds ? r.timestamp.seconds * 1000 : 0);
        return t <= fimMs;
      });
    }

    listaRegistrosCache = lista;

    if (listaRegistrosCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Nenhum registro no período selecionado.</td></tr>';
      return;
    }

    tbody.innerHTML = listaRegistrosCache.map(r => {
      const dataHora = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString('pt-BR') : '--';
      const foto = r.fotoSnapshot || '';
      return `
        <tr>
          <td><i class="fas fa-clock text-muted me-1"></i> ${dataHora}</td>
          <td><strong class="text-light">${r.funcionarioNome || 'Desconhecido'}</strong></td>
          <td><code>${formatarCPF(r.cpf || '')}</code></td>
          <td><span class="badge-tipo badge-${r.tipo}">${TIPOS_LABEL[r.tipo] || r.tipo}</span></td>
          <td><i class="fas fa-fingerprint text-accent me-1"></i> ${r.confianca || 95}%</td>
          <td>
            ${foto 
              ? `<img src="${foto}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;cursor:pointer;" onclick="verFotoAmpliada('${foto}', '${r.funcionarioNome} - ${dataHora}')">`
              : '<span class="text-muted small">Sem foto</span>'}
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error('Erro ao carregar registros:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Erro ao carregar: ${err.message}</td></tr>`;
  }
}

function limparFiltrosData() {
  document.getElementById('filtro-data-inicio').value = '';
  document.getElementById('filtro-data-fim').value = '';
  carregarRegistros();
}

function exportarCSV() {
  if (listaRegistrosCache.length === 0) {
    alert('Nenhum registro para exportar.');
    return;
  }

  let csv = 'Data/Hora,Nome,CPF,Tipo,Confianca\n';
  listaRegistrosCache.forEach(r => {
    const dataHora = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString('pt-BR') : '';
    csv += `"${dataHora}","${r.funcionarioNome || ''}","${r.cpf || ''}","${TIPOS_LABEL[r.tipo] || r.tipo}","${r.confianca || 95}%"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `registros_ponto_${new Date().toISOString().slice(0, 10)}.csv`);
  link.click();
}

// ─── Espelho de Ponto ─────────────────────────────────
async function carregarOpcoesRelatorio() {
  const select = document.getElementById('select-relatorio-func');
  if (listaFuncionariosCache.length === 0) {
    const snap = await db.collection('funcionarios').get();
    listaFuncionariosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  select.innerHTML = '<option value="">-- Selecione o Colaborador --</option>' + 
    listaFuncionariosCache.map(f => `<option value="${f.cpf}">${f.nome} (${formatarCPF(f.cpf)})</option>`).join('');
}

async function gerarEspelho() {
  const cpf = document.getElementById('select-relatorio-func').value;
  const mesAno = document.getElementById('select-relatorio-mes').value;
  const tbody = document.getElementById('tabela-espelho-corpo');

  if (!cpf || !mesAno) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">Selecione um funcionário e mês acima.</td></tr>';
    return;
  }

  const [ano, mes] = mesAno.split('-').map(Number);
  const dataInicio = new Date(ano, mes - 1, 1);
  const dataFim = new Date(ano, mes, 0, 23, 59, 59);

  tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Calculando espelho...</td></tr>';

  try {
    const snap = await db.collection('registros')
      .where('cpf', '==', cpf)
      .get();

    const tInicioMs = dataInicio.getTime();
    const tFimMs = dataFim.getTime();
    const registros = snap.docs.map(d => d.data()).filter(r => {
      const dt = r.timestamp?.toDate ? r.timestamp.toDate().getTime() : 0;
      return dt >= tInicioMs && dt <= tFimMs;
    });

    // Agrupa por dia do mês
    const diasMes = dataFim.getDate();
    let linhasHtml = '';

    for (let dia = 1; dia <= diasMes; dia++) {
      const dataDia = new Date(ano, mes - 1, dia);
      const diaFormatado = String(dia).padStart(2, '0') + '/' + String(mes).padStart(2, '0');
      const nomeDiaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][dataDia.getDay()];

      const regsDia = registros.filter(r => {
        const dt = r.timestamp?.toDate ? r.timestamp.toDate() : null;
        return dt && dt.getDate() === dia;
      });

      const entrada = regsDia.find(r => r.tipo === 'entrada')?.timestamp?.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) || '--:--';
      const almocoSaida = regsDia.find(r => r.tipo === 'almoco_saida')?.timestamp?.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) || '--:--';
      const almocoRetorno = regsDia.find(r => r.tipo === 'almoco_retorno')?.timestamp?.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) || '--:--';
      const saida = regsDia.find(r => r.tipo === 'saida')?.timestamp?.toDate().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) || '--:--';

      const isFimDeSemana = dataDia.getDay() === 0 || dataDia.getDay() === 6;
      const temRegistro = regsDia.length > 0;

      linhasHtml += `
        <tr class="${isFimDeSemana ? 'opacity-75' : ''}">
          <td><strong>${diaFormatado}</strong> <span class="text-muted small">(${nomeDiaSemana})</span></td>
          <td><span class="${entrada !== '--:--' ? 'text-success fw-bold' : 'text-muted'}">${entrada}</span></td>
          <td><span class="${almocoSaida !== '--:--' ? 'text-warning fw-bold' : 'text-muted'}">${almocoSaida}</span></td>
          <td><span class="${almocoRetorno !== '--:--' ? 'text-info fw-bold' : 'text-muted'}">${almocoRetorno}</span></td>
          <td><span class="${saida !== '--:--' ? 'text-danger fw-bold' : 'text-muted'}">${saida}</span></td>
          <td>${temRegistro ? '<span class="badge bg-secondary">Calculado</span>' : '<span class="text-muted">-</span>'}</td>
        </tr>
      `;
    }

    tbody.innerHTML = linhasHtml;

  } catch (err) {
    console.error('Erro ao gerar espelho:', err);
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Erro ao calcular: ${err.message}</td></tr>`;
  }
}

// ─── Utilitários ──────────────────────────────────────
function formatarCPF(v) {
  const d = v.replace(/\D/g, '');
  if (d.length !== 11) return v;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function mascaraCPFModal(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  input.value = v;
}

function verFotoAmpliada(src, legenda) {
  document.getElementById('modal-foto-img').src = src;
  document.getElementById('modal-foto-legenda').textContent = legenda;
  modalFotoInstancia.show();
}
