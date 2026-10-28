# 🕐 Sistema de Ponto Eletrônico com Reconhecimento Facial

Sistema completo, moderno e funcional em Português (Brasil) para registro de ponto de funcionários via câmera e reconhecimento facial, acompanhado de painel administrativo com cadastro, monitoramento em tempo real e relatórios.

---

## 🚀 Como Iniciar o Sistema

### Método 1: Pelo arquivo executável (Windows)
Basta dar duplo clique no arquivo:
```
iniciar.bat
```

### Método 2: Via Terminal / PowerShell
1. Abra o terminal na pasta do projeto:
   ```powershell
   cd c:\Users\bruno\OneDrive\Desktop\ponto
   ```
2. Instale as dependências:
   ```bash
   pip install -r requirements.txt
   ```
3. Execute o servidor:
   ```bash
   python main.py
   ```

---

## 🌐 Endereços de Acesso

- **Bater Ponto (Terminal dos Funcionários):** [http://localhost:8000/](http://localhost:8000/)
- **Painel Administrativo:** [http://localhost:8000/admin](http://localhost:8000/admin)
- **Tela de Login:** [http://localhost:8000/login](http://localhost:8000/login)

### 🔑 Credenciais Padrão do Administrador
- **Usuário:** `admin`
- **Senha:** `admin123`

---

## 📋 Funcionalidades

### 1. 🎥 Terminal de Bater Ponto (`/`)
- Relógio digital em tempo real com data completa em PT-BR.
- Captura de imagem pela webcam em tempo real com guia circular de enquadramento.
- 4 Botões de Ação rápida:
  - 🟢 **Entrada**
  - 🟡 **Saída para Almoço**
  - 🔵 **Retorno do Almoço**
  - 🔴 **Saída**
- Feedback visual imediato com som/animação:
  - Foto do colaborador reconhecido, nome, cargo, departamento, horário exato e taxa de confiança.
  - Bloqueio contra batidas duplicadas no mesmo período.
- Histórico lateral com as últimas marcações atualizado em tempo real.

### 2. 👥 Painel de Funcionários (`/admin/funcionarios`)
- Lista com foto, nome, CPF, cargo, departamento, status facial e status ativo/inativo.
- **Cadastro de Novos Colaboradores:**
  - Formulário completo com validação e máscara de CPF.
  - **Captura direta da foto pela Webcam** dentro do formulário ou upload de foto do computador.
  - Extração automática dos vetores faciais (encoding) para reconhecimento.
- Edição de dados e ativação/desativação rápida de acesso.

### 3. 📊 Dashboard Administrativo (`/admin`)
- Indicadores do dia em tempo real:
  - Total de funcionários cadastrados.
  - Presentes hoje.
  - Ausentes hoje.
  - Total de registros efetuados.
- Gráfico de presenças ao longo dos últimos 7 dias.
- Lista recente de registros de ponto com atualização automática.

### 4. 📈 Relatórios e Exportação (`/admin/relatorios`)
- Filtragem por Mês, Ano e por Funcionário específico.
- Apuração diária com colunas: *Entrada*, *Saída Almoço*, *Retorno Almoço*, *Saída* e cálculo automático de *Total de Horas Trabalhadas*.
- **Exportação em formato CSV** (compatível com Excel com acentuação e formato brasileiro).

---

## 🧠 Motor de Reconhecimento Facial
- O sistema possui suporte híbrido inteligente:
  - **OpenCV Facial Detection & Feature Matcher:** Funciona nativamente sem exigir compiladores C++.
  - **Face Recognition / dlib (Opcional):** Se instalado no ambiente, o sistema passa a utilizar os 128 pontos biométricos de alta fidelidade automaticamente.
