const {
  selectFolder,
  selectFiles,
  organizeFiles,
  importFromSource,
  getAvailableFormats,
  onLog,
  onProgress,
  onStatus,
  pauseProcess,
  resumeProcess,
  cancelProcess,
  renumberFolder,
} = window.electronAPI;

const logArea           = document.getElementById("logArea");
const progressBar       = document.getElementById("progressBar");
const progressText      = document.getElementById("progressText");
const selectedFilesEl   = document.getElementById("selectedFiles");
const destPathEl        = document.getElementById("destPath");
const statusEl          = document.getElementById("statusBar");
const processControlsEl = document.getElementById("processControls");
const pauseBtn          = document.getElementById("pauseBtn");
const cancelBtn         = document.getElementById("cancelBtn");
const formatSelect      = document.getElementById("formatSelect");
const qualitySelect     = document.getElementById("qualitySelect");
const sourceInput       = document.getElementById("sourceInput");
const importBtn         = document.getElementById("importBtn");
const lineCounterEl     = document.getElementById("lineCounter");
const urlPreviewEl      = document.getElementById("urlPreview");
const sourceErrorEl     = document.getElementById("sourceError");
const destErrorEl       = document.getElementById("destError");
const qualityDetecting  = document.getElementById("qualityDetecting");
const customFolderInput = document.getElementById("customFolderInput");
const clearFolderBtn    = document.getElementById("clearFolderBtn");
const clearLogBtn       = document.getElementById("clearLogBtn");

let selectedFilePaths = [];
let destRoot = null;

// ── Helpers de visibilidade ───────────────────────────────────────────────────
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

// ── Carregar configurações salvas no localStorage ─────────────────────────────
const savedDestRoot = localStorage.getItem("destRoot");
if (savedDestRoot) {
  destRoot = savedDestRoot;
  destPathEl.textContent = savedDestRoot;
  destPathEl.classList.add("connected");
}

const savedCustomFolder = localStorage.getItem("customFolder");
if (savedCustomFolder) customFolderInput.value = savedCustomFolder;
customFolderInput.addEventListener("input", (e) => {
  localStorage.setItem("customFolder", e.target.value);
});

// ── Botão limpar campo de pasta ───────────────────────────────────────────────
clearFolderBtn.addEventListener("click", () => {
  customFolderInput.value = "";
  localStorage.removeItem("customFolder");
  customFolderInput.focus();
});

// ── Opções de qualidade estáticas (fallback) ──────────────────────────────────
const qualityOptions = {
  mp3: [
    { value: "320", text: "320 kbps (Alta)" },
    { value: "256", text: "256 kbps (Média)" },
    { value: "128", text: "128 kbps (Baixa)" }
  ],
  mp4: [
    { value: "2160", text: "2160p (4K UHD)" },
    { value: "1440", text: "1440p (2K QHD)" },
    { value: "1080", text: "1080p (Full HD)" },
    { value: "720",  text: "720p (HD)" },
    { value: "480",  text: "480p (SD)" },
    { value: "360",  text: "360p" },
    { value: "240",  text: "240p" }
  ]
};

const resolutionLabels = {
  2160: "2160p (4K UHD)",
  1440: "1440p (2K QHD)",
  1080: "1080p (Full HD)",
  720:  "720p (HD)",
  480:  "480p (SD)",
  360:  "360p",
  240:  "240p"
};

function populateQualitySelect(format, detectedResolutions = null) {
  qualitySelect.innerHTML = "";

  if (format === "mp3" || !detectedResolutions || detectedResolutions.length === 0) {
    // Opções estáticas — restaura qualidade salva
    const savedQuality = localStorage.getItem("downloadQuality") || (format === "mp3" ? "320" : "1080");
    const opts = qualityOptions[format] || [];
    opts.forEach((opt) => {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.text;
      qualitySelect.appendChild(el);
    });
    // Restaura seleção anterior se existir na lista
    if (savedQuality && [...qualitySelect.options].some(o => o.value === savedQuality)) {
      qualitySelect.value = savedQuality;
    }
  } else {
    // Resoluções detectadas reais — seleciona sempre a máxima disponível
    detectedResolutions.forEach((res) => {
      const el = document.createElement("option");
      el.value = String(res);
      el.textContent = resolutionLabels[res] || `${res}p`;
      qualitySelect.appendChild(el);
    });
    // Auto-seleciona a maior resolução (primeiro item, lista já vem em ordem desc)
    qualitySelect.selectedIndex = 0;
    localStorage.setItem("downloadQuality", qualitySelect.value);
  }
}

// ── Carregar preferências salvas de formato ───────────────────────────────────
const savedFormat = localStorage.getItem("downloadFormat") || "mp3";
formatSelect.value = savedFormat;
populateQualitySelect(savedFormat);

formatSelect.addEventListener("change", (e) => {
  const format = e.target.value;
  localStorage.setItem("downloadFormat", format);
  populateQualitySelect(format);
  // Re-detecta qualidades se já tem URL e é mp4
  triggerQualityDetection();
});

qualitySelect.addEventListener("change", (e) => {
  localStorage.setItem("downloadQuality", e.target.value);
});

// ── Detecção inteligente de qualidades (debounce 800ms) ──────────────────────
let detectionTimer = null;

function isYouTubeUrl(val) {
  return /youtube\.com|youtu\.be/.test(val);
}

function triggerQualityDetection() {
  clearTimeout(detectionTimer);
  const val = sourceInput.value.trim();
  const format = formatSelect.value;

  // Só consulta para MP4 + URL única do YouTube (não para buscas de texto, não para playlists em MP3)
  if (format !== "mp4" || !isYouTubeUrl(val) || val.includes("\n")) {
    hide(qualityDetecting);
    return;
  }

  // Detecta apenas a primeira linha caso múltiplas
  const firstUrl = val.split("\n")[0].trim();

  detectionTimer = setTimeout(async () => {
    // Mostra badge "detectando"
    qualityDetecting.textContent = "🔍 detectando...";
    qualityDetecting.classList.remove("detected");
    show(qualityDetecting);
    try {
      const result = await getAvailableFormats(firstUrl);
      if (result && result.resolutions && result.resolutions.length > 0) {
        populateQualitySelect("mp4", result.resolutions);
        // Badge muda para sucesso por 2s antes de sumir
        qualityDetecting.textContent = `✔ ${result.resolutions.length} resoluções`;
        qualityDetecting.classList.add("detected");
        setTimeout(() => hide(qualityDetecting), 2000);
        // Preview com título do vídeo
        if (result.title) {
          urlPreviewEl.textContent = `📹 ${result.title} · ${resolutionLabels[result.resolutions[0]] || result.resolutions[0] + "p"} disponível`;
          show(urlPreviewEl);
        }
      } else {
        hide(qualityDetecting);
      }
    } catch (_) {
      // Fallback silencioso para opções estáticas
      hide(qualityDetecting);
    }
  }, 800);
}

// ── Contador de linhas + habilitação do botão + preview ──────────────────────
function updateSourceState() {
  const val = sourceInput.value.trim();
  const lines = val ? val.split("\n").filter((l) => l.trim().length > 0) : [];
  const count = lines.length;

  // Contador de itens
  if (count > 0) {
    lineCounterEl.textContent = `${count} ${count === 1 ? "item" : "itens"}`;
    show(lineCounterEl);
  } else {
    hide(lineCounterEl);
    hide(urlPreviewEl);
  }

  // Habilita/desabilita botão
  importBtn.disabled = count === 0;

  // Esconde erro de campo vazio ao digitar
  if (count > 0) hide(sourceErrorEl);

  // Se não é YouTube URL, esconde preview
  if (!isYouTubeUrl(val) || count === 0) hide(urlPreviewEl);
}

sourceInput.addEventListener("input", () => {
  updateSourceState();
  triggerQualityDetection();
});

// Inicializa estado
updateSourceState();

// ── Ctrl+Enter para importar ──────────────────────────────────────────────────
sourceInput.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "Enter") {
    e.preventDefault();
    importBtn.click();
  }
});

// ── Limpar log ────────────────────────────────────────────────────────────────
clearLogBtn.addEventListener("click", (e) => {
  e.preventDefault();
  // Limpa o conteúdo de forma limpa sem problemas de parsing
  while (logArea.firstChild) {
    logArea.removeChild(logArea.firstChild);
  }
  appendLog("🗑 Log limpo.");
});

function appendLog(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
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
  statusEl.className = "";
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
    hide(destErrorEl);
  }
});

document.getElementById("organizeBtn").addEventListener("click", async () => {
  if (selectedFilePaths.length === 0) return alert("Selecione ao menos um arquivo de áudio.");
  if (!destRoot) return alert("Selecione a pasta de destino.");

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

importBtn.addEventListener("click", async () => {
  const source = sourceInput.value.trim();
  const customFolder = customFolderInput.value.trim();

  // Validações inline (sem alert)
  if (!source) {
    show(sourceErrorEl);
    sourceInput.focus();
    return;
  }
  if (!destRoot) {
    show(destErrorEl);
    return;
  }

  hide(sourceErrorEl);
  hide(destErrorEl);

  const format = formatSelect.value;
  const quality = qualitySelect.value;
  const qualityLabel = format === "mp3"
    ? `${quality}kbps`
    : `${quality}p`;

  setProgress(0);
  showProcessControls();
  appendLog(`⏳ Importando (${format.toUpperCase()} · ${qualityLabel})...`);

  try {
    const results = await importFromSource(source, destRoot, customFolder, { format, quality });
    const successCount = results.filter((r) => r.success).length;
    appendLog(`✅ Concluído: ${successCount}/${results.length} arquivo(s) organizado(s).`);

    // Limpa o campo de URL e preview após sucesso
    sourceInput.value = "";
    hide(urlPreviewEl);
    hide(lineCounterEl);
    importBtn.disabled = true;
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