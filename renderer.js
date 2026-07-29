const {
  selectFolder,
  selectFiles,
  organizeFiles,
  importFromSource,
  onLog,
  onProgress,
  onStatus, // 🔥 NOVO
} = window.electronAPI;

const logArea = document.getElementById("logArea");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const selectedFilesEl = document.getElementById("selectedFiles");
const destPathEl = document.getElementById("destPath");
const statusEl = document.getElementById("statusBar"); // 🔥 NOVO

let selectedFilePaths = [];
let destRoot = null;

function appendLog(msg) {
  const p = document.createElement("p");
  p.textContent = msg;
  logArea.appendChild(p);
  logArea.scrollTop = logArea.scrollHeight;
}

function setProgress(value) {
  progressBar.value = value;
  progressText.textContent = `${Math.round(value)}%`;
}

// 🔥 Atualiza a barra de status
onStatus((msg) => {
  statusEl.textContent = msg;
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
  appendLog("⏳ Organizando biblioteca...");

  try {
    const results = await organizeFiles(selectedFilePaths, destRoot);
    const successCount = results.filter((r) => r.success).length;
    appendLog(`✅ Concluído: ${successCount}/${results.length} arquivo(s) organizado(s).`);
  } catch (err) {
    appendLog(`❌ Falha: ${err.message}`);
  }
});

document.getElementById("importBtn").addEventListener("click", async () => {
  const source = document.getElementById("sourceInput").value.trim();
  const customFolder = document.getElementById("customFolderInput").value.trim();
  if (!source) return alert("Informe a URL ou fonte.");
  if (!destRoot) return alert("Selecione a pasta de destino.");

  setProgress(0);
  appendLog("⏳ Importando da fonte externa...");

  try {
    const results = await importFromSource(source, destRoot, customFolder);
    const successCount = results.filter((r) => r.success).length;
    appendLog(`✅ Concluído: ${successCount}/${results.length} arquivo(s) organizado(s).`);
  } catch (err) {
    appendLog(`❌ ${err.message}`);
  }
});