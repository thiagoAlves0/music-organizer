const {
  selectFolder,
  selectFiles,
  organizeFiles,
  importFromSource,
  onLog,
  onProgress,
  onStatus,
  pauseProcess,
  resumeProcess,
  cancelProcess,
  renumberFolder,
} = window.electronAPI;

const logArea = document.getElementById("logArea");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const selectedFilesEl = document.getElementById("selectedFiles");
const destPathEl = document.getElementById("destPath");
const statusEl = document.getElementById("statusBar");
const processControlsEl = document.getElementById("processControls");
const pauseBtn = document.getElementById("pauseBtn");
const cancelBtn = document.getElementById("cancelBtn");

let selectedFilePaths = [];
let destRoot = null;

// 🔥 ITEM A: Carregar configurações salvas no localStorage
const savedDestRoot = localStorage.getItem("destRoot");
if (savedDestRoot) {
  destRoot = savedDestRoot;
  destPathEl.textContent = savedDestRoot;
  destPathEl.classList.add("connected");
}

const customFolderInput = document.getElementById("customFolderInput");
const savedCustomFolder = localStorage.getItem("customFolder");
if (savedCustomFolder) {
  customFolderInput.value = savedCustomFolder;
}

// Salvar customFolder no localStorage sempre que o usuário digitar
customFolderInput.addEventListener("input", (e) => {
  localStorage.setItem("customFolder", e.target.value);
});

function appendLog(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  // Aplica classe de cor conforme o prefixo da mensagem
  if (msg.startsWith("✔") || msg.startsWith("✅") || msg.includes("Organizado")) {
    p.className = "log-success";
  } else if (msg.startsWith("❌") || msg.toLowerCase().includes("erro") || msg.toLowerCase().includes("falha")) {
    p.className = "log-error";
  } else {
    p.className = "log-info";
  }
  logArea.appendChild(p);
  logArea.scrollTop = logArea.scrollHeight;
}

function setProgress(value) {
  if (value === null || value === undefined) return;
  progressBar.value = value;
  progressText.textContent = `${Math.round(value)}%`;
}

// ── Controles de processo ─────────────────────────────────────────────────────
let paused = false;

function showProcessControls() {
  paused = false;
  pauseBtn.textContent = "⏸ Pausar";
  pauseBtn.classList.remove("paused");
  processControlsEl.classList.remove("hidden");
}

function hideProcessControls() {
  processControlsEl.classList.add("hidden");
  paused = false;
  pauseBtn.textContent = "⏸ Pausar";
  pauseBtn.classList.remove("paused");
}

pauseBtn.addEventListener("click", () => {
  if (!paused) {
    paused = true;
    pauseProcess();
    pauseBtn.textContent = "▶ Retomar";
    pauseBtn.classList.add("paused");
    statusEl.textContent = "⏸ Pausado...";
    statusEl.className = "";
  } else {
    paused = false;
    resumeProcess();
    pauseBtn.textContent = "⏸ Pausar";
    pauseBtn.classList.remove("paused");
  }
});

cancelBtn.addEventListener("click", () => {
  cancelProcess();
  appendLog("✖ Cancelando...");
  statusEl.textContent = "✖ Cancelando...";
  statusEl.className = "";
  hideProcessControls();
});


// Atualiza a barra de status com classes de cor
onStatus((msg) => {
  statusEl.textContent = msg;
  statusEl.className = ""; // limpa classes anteriores
  if (msg.startsWith("✅")) statusEl.classList.add("success");
  else if (msg.startsWith("❌")) statusEl.classList.add("error");
});

onLog((msg) => appendLog(msg));
onProgress((value) => setProgress(value));

document.getElementById("pickFilesBtn").addEventListener("click", async () => {
  const files = await selectFiles();
  if (files && files.length > 0) {
    selectedFilePaths = files;
    selectedFilesEl.textContent = `${files.length} arquivo(s) selecionado(s)`;
  }
});

document.getElementById("pickDestBtn").addEventListener("click", async () => {
  const folder = await selectFolder();
  if (folder) {
    destRoot = folder;
    destPathEl.textContent = folder;
    destPathEl.classList.add("connected");
    localStorage.setItem("destRoot", folder);
  }
});

document.getElementById("organizeBtn").addEventListener("click", async () => {
  if (selectedFilePaths.length === 0) {
    return alert("Selecione ao menos um arquivo de áudio.");
  }
  if (!destRoot) {
    return alert("Selecione a pasta de destino.");
  }

  setProgress(0);
  showProcessControls();
  appendLog("⏳ Organizando biblioteca...");

  try {
    const results = await organizeFiles(selectedFilePaths, destRoot);
    const successCount = results.filter((r) => r.success).length;
    appendLog(`✅ Concluído: ${successCount}/${results.length} arquivo(s) organizado(s).`);
  } catch (err) {
    appendLog(`❌ Falha: ${err.message}`);
  } finally {
    hideProcessControls();
  }
});

document.getElementById("importBtn").addEventListener("click", async () => {
  const source = document.getElementById("sourceInput").value.trim();
  const customFolder = document.getElementById("customFolderInput").value.trim();
  if (!source) return alert("Informe a URL ou nome da música.");
  if (!destRoot) return alert("Selecione a pasta de destino.");

  setProgress(0);
  showProcessControls();
  appendLog("⏳ Importando...");

  try {
    const results = await importFromSource(source, destRoot, customFolder);
    const successCount = results.filter((r) => r.success).length;
    appendLog(`✅ Concluído: ${successCount}/${results.length} arquivo(s) organizado(s).`);
  } catch (err) {
    if (!err.message?.includes("cancelad") && !err.name?.includes("Abort")) {
      appendLog(`❌ ${err.message}`);
    }
  } finally {
    hideProcessControls();
  }
});

// ── Renumerar pasta ───────────────────────────────────────────────────────────
document.getElementById("renumberBtn").addEventListener("click", async () => {
  const folderPath = await selectFolder();
  if (!folderPath) return;

  appendLog(`⏳ Renumerando arquivos em: ${folderPath}...`);
  setProgress(0);

  try {
    const result = await renumberFolder(folderPath);
    setProgress(100);
    if (result.success) {
      appendLog(`✅ ${result.renamed} arquivo(s) renumerado(s) com sucesso.`);
    } else {
      appendLog(`⚠️ ${result.renamed} renumerado(s), mas com erros: ${result.errors.join(", ")}`);
    }
  } catch (err) {
    appendLog(`❌ Falha: ${err.message}`);
  }
});