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

function extrairData(ts) {
  if (!ts) return null;
  if (ts.toDate && typeof ts.toDate === 'function') return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  if (typeof ts === 'string') return new Date(ts);
  if (ts instanceof Date) return ts;
  return null;
}

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

  const sec = document.getElementById(`aba-${aba}`);
  if (sec) sec.classList.remove('d-none');
  if (el) el.classList.add('ativo');

  if (aba === 'dashboard') carregarDadosGerais();
  if (aba === 'funcionarios') carregarFuncionarios();
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

    // 3. Colaboradores com Registro Hoje (Agrupado com clique para expandir pontos)
    const containerDash = document.getElementById('lista-colaboradores-dash');
    const badgeTotalColabs = document.getElementById('dash-badge-total-colabs');

    const registrosParaExibir = registrosHoje.length > 0 ? registrosHoje : todosRegistros;

    if (registrosParaExibir.length === 0) {
      if (containerDash) {
        containerDash.innerHTML = '<div class="text-center py-4 text-muted"><i class="fas fa-inbox fs-2 mb-2 d-block"></i>Nenhum ponto registrado hoje ainda.</div>';
      }
      if (badgeTotalColabs) badgeTotalColabs.textContent = '0 colaboradores';
      return;
    }

    // Agrupa os registros por funcionário (CPF)
    const mapaColabs = new Map();
    registrosParaExibir.forEach(r => {
      const cleanCpf = (r.cpf || '').replace(/\D/g, '');
      if (!cleanCpf) return;
      if (!mapaColabs.has(cleanCpf)) {
        const fInfo = listaFuncionariosCache.find(f => (f.cpf || '').replace(/\D/g, '') === cleanCpf);
        mapaColabs.set(cleanCpf, {
          cpf: cleanCpf,
          nome: r.funcionarioNome || fInfo?.nome || 'Colaborador',
          cargo: fInfo?.cargo || r.cargo || '',
          departamento: fInfo?.departamento || r.departamento || '',
          fotoPerfil: fInfo?.fotoBase64 || r.fotoSnapshot || '',
          registros: []
        });
      }
      mapaColabs.get(cleanCpf).registros.push(r);
    });

    const listaAgrupada = Array.from(mapaColabs.values());
    if (badgeTotalColabs) {
      badgeTotalColabs.textContent = `${listaAgrupada.length} colaborador${listaAgrupada.length === 1 ? '' : 'es'}`;
    }

    if (containerDash) {
      containerDash.innerHTML = listaAgrupada.map(colab => {
        // Ordena registros do mais recente para o mais antigo
        const regs = colab.registros.sort((a, b) => {
          const ta = extrairData(a.timestamp)?.getTime() || 0;
          const tb = extrairData(b.timestamp)?.getTime() || 0;
          return tb - ta;
        });

        const ultimo = regs[0];
        const dtUltimo = extrairData(ultimo.timestamp);
        const horaUltimo = dtUltimo ? dtUltimo.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}) : '--:--';
        const fotoPerfil = colab.fotoPerfil || ultimo.fotoSnapshot || '';

        const fotoTag = fotoPerfil 
          ? `<img src="${fotoPerfil}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);cursor:pointer;" onclick="verFotoAmpliada('${fotoPerfil}', '${colab.nome}')">`
          : `<div style="width:48px;height:48px;border-radius:50%;background:#2a2f3a;display:flex;align-items:center;justify-content:center;color:#e94560;font-weight:bold;font-size:1.2rem;">${colab.nome.charAt(0)}</div>`;

        const linhasPontos = regs.map(reg => {
          const dt = extrairData(reg.timestamp);
          const dataHoraStr = dt ? dt.toLocaleString('pt-BR') : '--';
          const horaStr = dt ? dt.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', second:'2-digit'}) : '--';
          const fotoReg = reg.fotoSnapshot || '';

          return `
            <tr>
              <td class="text-light fw-bold"><i class="fas fa-clock text-accent me-1"></i> ${horaStr} <small class="text-muted">(${dt ? dt.toLocaleDateString('pt-BR') : ''})</small></td>
              <td><span class="badge-tipo badge-${reg.tipo}">${TIPOS_LABEL[reg.tipo] || reg.tipo}</span></td>
              <td><span class="text-light"><i class="fas fa-fingerprint text-accent me-1"></i> ${reg.confianca || 92}%</span></td>
              <td>
                ${fotoReg 
                  ? `<img src="${fotoReg}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;cursor:pointer;border:1px solid #555;" onclick="verFotoAmpliada('${fotoReg}', '${colab.nome} - ${dataHoraStr}')">`
                  : '<span class="text-muted small">Sem foto</span>'}
              </td>
            </tr>
          `;
        }).join('');

        return `
          <div class="border border-secondary rounded-3 bg-dark p-3" style="cursor: pointer;" onclick="togglePontosDash('${colab.cpf}', event)">
            <div class="d-flex justify-content-between align-items-center flex-wrap gap-2">
              <div class="d-flex align-items-center gap-3">
                ${fotoTag}
                <div>
                  <h6 class="fw-bold text-light mb-0 fs-5">${colab.nome}</h6>
                  <div class="text-muted small">${colab.cargo || 'Funcionário'} ${colab.departamento ? '· ' + colab.departamento : ''} · CPF: ${formatarCPF(colab.cpf)}</div>
                </div>
              </div>

              <div class="d-flex align-items-center gap-3">
                <div class="text-end">
                  <span class="badge bg-danger fs-6">${regs.length} batida${regs.length === 1 ? '' : 's'}</span>
                  <div class="small text-muted mt-1">Último: <span class="badge-tipo badge-${ultimo.tipo}">${TIPOS_LABEL[ultimo.tipo] || ultimo.tipo} às ${horaUltimo}</span></div>
                </div>
                <div class="p-2 rounded-circle bg-secondary bg-opacity-25 text-accent d-flex align-items-center justify-content-center" style="width:36px;height:36px;">
                  <i class="fas fa-chevron-down fs-6" id="icone-dash-${colab.cpf}"></i>
                </div>
              </div>
            </div>

            <!-- GAVETA EXPANSÍVEL COM TODOS OS PONTOS (ABRE AO CLICAR NO COLABORADOR) -->
            <div id="gaveta-dash-${colab.cpf}" class="d-none mt-3 pt-3 border-top border-secondary">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <span class="text-muted small fw-bold text-uppercase"><i class="fas fa-history text-accent me-1"></i> Histórico de Batidas de ${colab.nome}:</span>
                <span class="small text-muted">Clique na foto para ampliar</span>
              </div>
              <div class="table-responsive">
                <table class="table table-dark table-sm table-hover mb-0 align-middle">
                  <thead>
                    <tr class="text-muted small">
                      <th>Horário</th>
                      <th>Tipo do Ponto</th>
                      <th>Biometria Facial</th>
                      <th>Foto</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${linhasPontos}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

  } catch (err) {
    console.error('Erro ao carregar dados gerais:', err);
  }
}

function togglePontosDash(cpf, event) {
  // Evita conflito se clicar diretamente na foto para abrir o modal de zoom
  if (event && event.target && event.target.tagName === 'IMG') return;

  const gaveta = document.getElementById(`gaveta-dash-${cpf}`);
  const icone = document.getElementById(`icone-dash-${cpf}`);
  if (gaveta) {
    const estaFechado = gaveta.classList.contains('d-none');
    if (estaFechado) {
      gaveta.classList.remove('d-none');
      if (icone) {
        icone.classList.remove('fa-chevron-down');
        icone.classList.add('fa-chevron-up');
      }
    } else {
      gaveta.classList.add('d-none');
      if (icone) {
        icone.classList.remove('fa-chevron-up');
        icone.classList.add('fa-chevron-down');
      }
    }
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

// ─── Exportação de Registros (CSV) ────────────────────
async function exportarCSV() {
  try {
    let registros = listaRegistrosCache;
    if (!registros || registros.length === 0) {
      const snap = await db.collection('registros').get();
      registros = snap.docs.map(d => d.data());
    }

    if (!registros || registros.length === 0) {
      alert('Nenhum registro encontrado para exportar.');
      return;
    }

    // Ordena do mais recente para o mais antigo
    registros.sort((a, b) => {
      const ta = extrairData(a.timestamp)?.getTime() || 0;
      const tb = extrairData(b.timestamp)?.getTime() || 0;
      return tb - ta;
    });

    let csv = 'Data/Hora,Nome,CPF,Tipo,Confianca\n';
    registros.forEach(r => {
      const dt = extrairData(r.timestamp);
      const dataHora = dt ? dt.toLocaleString('pt-BR') : '';
      csv += `"${dataHora}","${r.funcionarioNome || ''}","${formatarCPF(r.cpf || '')}","${TIPOS_LABEL[r.tipo] || r.tipo}","${r.confianca || 95}%"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `registros_ponto_${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  } catch (err) {
    console.error('Erro ao exportar CSV:', err);
    alert('Erro ao exportar: ' + err.message);
  }
}

// ─── Espelho de Ponto & Horas Extras ───────────────────
function formatarHM(min, mostrarSinal = false) {
  if (min === 0) return '0h 00m';
  const sinal = min < 0 ? '-' : (mostrarSinal ? '+' : '');
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sinal}${h}h ${String(m).padStart(2, '0')}m`;
}

function imprimirFolhaA4() {
  window.print();
}

async function carregarOpcoesRelatorio() {
  const select = document.getElementById('select-relatorio-func');
  const inputMes = document.getElementById('select-relatorio-mes');
  if (inputMes && !inputMes.value) {
    const agora = new Date();
    inputMes.value = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  }

  if (listaFuncionariosCache.length === 0) {
    const snap = await db.collection('funcionarios').get();
    listaFuncionariosCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  if (listaFuncionariosCache.length === 0) {
    select.innerHTML = '<option value="">Nenhum colaborador cadastrado</option>';
    return;
  }

  select.innerHTML = listaFuncionariosCache.map(f => 
    `<option value="${f.cpf}">${f.nome} (CPF: ${formatarCPF(f.cpf)})</option>`
  ).join('');

  // Seleciona automaticamente o primeiro funcionário se não selecionado
  if (!select.value && listaFuncionariosCache.length > 0) {
    select.value = listaFuncionariosCache[0].cpf;
  }
  await gerarEspelho();
}

async function gerarEspelho() {
  const selectFunc = document.getElementById('select-relatorio-func');
  const inputMes = document.getElementById('select-relatorio-mes');
  const selectJornada = document.getElementById('select-relatorio-jornada');
  const tbody = document.getElementById('tabela-espelho-corpo');

  if (!inputMes.value) {
    const agora = new Date();
    inputMes.value = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  }

  const cpf = selectFunc ? selectFunc.value : '';
  const mesAno = inputMes ? inputMes.value : '';
  const jornadaTipo = selectJornada ? selectJornada.value : '8h_seg_sex';

  if (!cpf || !mesAno) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Selecione um funcionário e mês acima.</td></tr>';
    return;
  }

  const [ano, mes] = mesAno.split('-').map(Number);
  const dataInicio = new Date(ano, mes - 1, 1, 0, 0, 0);
  const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999);
  const diasMes = dataFim.getDate();

  const cleanCpf = cpf.replace(/\D/g, '');
  const func = listaFuncionariosCache.find(f => (f.cpf || '').replace(/\D/g, '') === cleanCpf);
  const nomeFunc = func ? func.nome : 'Colaborador';

  // Atualiza cabeçalho oficial do espelho (visível na tela e na impressão A4)
  const elPeriodo = document.getElementById('folha-periodo-str');
  if (elPeriodo) {
    elPeriodo.textContent = `01/${String(mes).padStart(2, '0')}/${ano} a ${String(diasMes).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}`;
  }
  const elEmissao = document.getElementById('folha-data-emissao');
  if (elEmissao) {
    const agora = new Date();
    elEmissao.textContent = agora.toLocaleDateString('pt-BR') + ' ' + agora.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  }
  const elFuncNome = document.getElementById('folha-func-nome');
  if (elFuncNome) elFuncNome.textContent = nomeFunc;
  const elFuncCpf = document.getElementById('folha-func-cpf');
  if (elFuncCpf) elFuncCpf.textContent = formatarCPF(cleanCpf);
  const elFuncCargo = document.getElementById('folha-func-cargo');
  if (elFuncCargo) elFuncCargo.textContent = func?.cargo || 'Não informado';
  const elFuncDep = document.getElementById('folha-func-dep');
  if (elFuncDep) elFuncDep.textContent = func?.departamento || 'Geral';
  const elFuncJornada = document.getElementById('folha-func-jornada');
  if (elFuncJornada) {
    const rotulos = {
      '8h_seg_sex': '8 horas diárias (Seg a Sex - 40h/sem)',
      '8h_seg_sex_4h_sab': '8h Seg-Sex + 4h Sáb (44h/sem CLT)',
      '6h_diarias': '6 horas diárias (Seg a Sex - 30h/sem)'
    };
    elFuncJornada.textContent = rotulos[jornadaTipo] || '8 horas diárias';
  }
  const elAssinaturaFunc = document.getElementById('assinatura-nome-func');
  if (elAssinaturaFunc) elAssinaturaFunc.textContent = nomeFunc;

  tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Calculando espelho e horas extras...</td></tr>';

  try {
    const snap = await db.collection('registros').get();

    const tInicioMs = dataInicio.getTime();
    const tFimMs = dataFim.getTime();

    const registros = snap.docs.map(d => d.data()).filter(r => {
      const rCpf = (r.cpf || '').replace(/\D/g, '');
      const dt = extrairData(r.timestamp)?.getTime() || 0;
      return rCpf === cleanCpf && dt >= tInicioMs && dt <= tFimMs;
    });

    let linhasHtml = '';
    let totalMinutosTrabalhados = 0;
    let totalMinutosPrevistos = 0;
    let totalMinutosExtras = 0;
    let totalMinutosAtrasos = 0;
    let diasTrabalhados = 0;

    for (let dia = 1; dia <= diasMes; dia++) {
      const dataDia = new Date(ano, mes - 1, dia);
      const diaFormatado = String(dia).padStart(2, '0') + '/' + String(mes).padStart(2, '0');
      const diaSemana = dataDia.getDay(); // 0 = Dom, 6 = Sáb
      const nomeDiaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][diaSemana];
      const isFimDeSemana = diaSemana === 0 || diaSemana === 6;

      // Carga horária prevista do dia em minutos
      let minutosPrevistos = 0;
      if (jornadaTipo === '8h_seg_sex') {
        minutosPrevistos = (diaSemana >= 1 && diaSemana <= 5) ? 480 : 0;
      } else if (jornadaTipo === '8h_seg_sex_4h_sab') {
        minutosPrevistos = (diaSemana >= 1 && diaSemana <= 5) ? 480 : (diaSemana === 6 ? 240 : 0);
      } else if (jornadaTipo === '6h_diarias') {
        minutosPrevistos = (diaSemana >= 1 && diaSemana <= 5) ? 360 : 0;
      }
      totalMinutosPrevistos += minutosPrevistos;

      const regsDia = registros.filter(r => {
        const dt = extrairData(r.timestamp);
        return dt && dt.getDate() === dia && dt.getMonth() === (mes - 1) && dt.getFullYear() === ano;
      });

      const regEntrada = regsDia.find(r => r.tipo === 'entrada');
      const regAlmocoSaida = regsDia.find(r => r.tipo === 'almoco_saida');
      const regAlmocoRetorno = regsDia.find(r => r.tipo === 'almoco_retorno');
      const regSaida = regsDia.find(r => r.tipo === 'saida');

      const entrada = regEntrada ? extrairData(regEntrada.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '--:--';
      const almocoSaida = regAlmocoSaida ? extrairData(regAlmocoSaida.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '--:--';
      const almocoRetorno = regAlmocoRetorno ? extrairData(regAlmocoRetorno.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '--:--';
      const saida = regSaida ? extrairData(regSaida.timestamp).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '--:--';

      // Cálculo de minutos trabalhados
      let minutosDia = 0;
      const getMs = (r) => extrairData(r?.timestamp)?.getTime() || 0;

      if (regEntrada && regSaida) {
        if (regAlmocoSaida && regAlmocoRetorno) {
          minutosDia = Math.max(0, Math.round((getMs(regAlmocoSaida) - getMs(regEntrada)) / 60000)) + 
                       Math.max(0, Math.round((getMs(regSaida) - getMs(regAlmocoRetorno)) / 60000));
        } else {
          minutosDia = Math.max(0, Math.round((getMs(regSaida) - getMs(regEntrada)) / 60000));
        }
      } else if (regEntrada && regAlmocoSaida && !regSaida) {
        minutosDia = Math.max(0, Math.round((getMs(regAlmocoSaida) - getMs(regEntrada)) / 60000));
      }

      // Cálculo de Horas Extras e Atrasos / Faltas
      let extrasDia = 0;
      let atrasoDia = 0;

      if (regsDia.length > 0) {
        diasTrabalhados++;
        totalMinutosTrabalhados += minutosDia;

        if (minutosPrevistos === 0) {
          // Trabalho em dia de descanso (Folga/DSR) -> 100% Horas Extras
          extrasDia = minutosDia;
        } else {
          if (minutosDia > minutosPrevistos) {
            extrasDia = minutosDia - minutosPrevistos;
          } else if (minutosDia < minutosPrevistos && regSaida) {
            atrasoDia = minutosPrevistos - minutosDia;
          }
        }
      }

      totalMinutosExtras += extrasDia;
      totalMinutosAtrasos += atrasoDia;

      // Formatação para exibição
      let totalTrabStr = '<span class="text-muted">-</span>';
      if (minutosDia > 0) {
        totalTrabStr = `<strong>${formatarHM(minutosDia)}</strong>`;
      } else if (regsDia.length > 0) {
        totalTrabStr = `<span class="badge bg-info">Em andamento</span>`;
      }

      const cargaStr = minutosPrevistos > 0 ? `${minutosPrevistos / 60}h 00m` : '<span class="text-muted">Folga</span>';
      const extrasStr = extrasDia > 0 ? `<span class="badge bg-success">+${formatarHM(extrasDia)}</span>` : '<span class="text-muted">-</span>';
      
      let saldoDiaStr = '<span class="text-muted">-</span>';
      if (extrasDia > 0) {
        saldoDiaStr = `<strong class="text-success">+${formatarHM(extrasDia)}</strong>`;
      } else if (atrasoDia > 0) {
        saldoDiaStr = `<strong class="text-danger">-${formatarHM(atrasoDia)}</strong>`;
      } else if (minutosDia > 0) {
        saldoDiaStr = `<span class="text-muted">0h 00m</span>`;
      }

      linhasHtml += `
        <tr class="${isFimDeSemana ? 'fim-de-semana opacity-75' : ''}">
          <td><strong>${diaFormatado}</strong> <span class="text-muted small">(${nomeDiaSemana})</span></td>
          <td><span class="${entrada !== '--:--' ? 'text-success fw-bold' : 'text-muted'}">${entrada}</span></td>
          <td><span class="${almocoSaida !== '--:--' ? 'text-warning fw-bold' : 'text-muted'}">${almocoSaida}</span></td>
          <td><span class="${almocoRetorno !== '--:--' ? 'text-info fw-bold' : 'text-muted'}">${almocoRetorno}</span></td>
          <td><span class="${saida !== '--:--' ? 'text-danger fw-bold' : 'text-muted'}">${saida}</span></td>
          <td>${totalTrabStr}</td>
          <td><span class="small">${cargaStr}</span></td>
          <td>${extrasStr}</td>
          <td>${saldoDiaStr}</td>
        </tr>
      `;
    }

    tbody.innerHTML = linhasHtml;

    // Atualiza cards de resumo superiores na tela
    const elTotalHoras = document.getElementById('total-horas-mes');
    if (elTotalHoras) elTotalHoras.textContent = formatarHM(totalMinutosTrabalhados);

    const elCargaPrevista = document.getElementById('total-carga-prevista-mes');
    if (elCargaPrevista) elCargaPrevista.textContent = formatarHM(totalMinutosPrevistos);

    const elHorasExtras = document.getElementById('total-horas-extras-mes');
    if (elHorasExtras) elHorasExtras.textContent = `+${formatarHM(totalMinutosExtras)}`;

    const elAtrasos = document.getElementById('total-atrasos-mes');
    if (elAtrasos) elAtrasos.textContent = `-${formatarHM(totalMinutosAtrasos)}`;

    const saldoTotalMinutos = totalMinutosExtras - totalMinutosAtrasos;
    const elSaldoHoras = document.getElementById('saldo-horas-mes');
    if (elSaldoHoras) {
      if (saldoTotalMinutos >= 0) {
        elSaldoHoras.className = 'fw-bold mb-0 mt-1 text-success';
        elSaldoHoras.textContent = `+${formatarHM(saldoTotalMinutos)}`;
      } else {
        elSaldoHoras.className = 'fw-bold mb-0 mt-1 text-danger';
        elSaldoHoras.textContent = `-${formatarHM(Math.abs(saldoTotalMinutos))}`;
      }
    }

  } catch (err) {
    console.error('Erro ao gerar espelho:', err);
    tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-danger">Erro ao calcular: ${err.message}</td></tr>`;
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
