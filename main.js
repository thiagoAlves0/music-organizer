const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const Organizer = require("./modules/organizer");
const Downloader = require("./modules/downloader");
const Logger = require("./modules/logger");

let mainWindow;

// ── Estado global do processo ─────────────────────────────────────────────────
let processState = {
  isPaused: false,
  isCancelled: false,
  abortController: null,   // AbortController atual — matar o yt-dlp imediatamente
  pauseResolve: null,       // resolve da Promise de pausa
};

/** Reseta o estado para um novo processo */
function resetProcessState() {
  processState.isPaused = false;
  processState.isCancelled = false;
  processState.abortController = new AbortController();
  processState.pauseResolve = null;
}

/** Aguarda se estiver pausado (chamado entre cada música) */
function checkPause() {
  if (!processState.isPaused) return Promise.resolve();
  return new Promise((resolve) => {
    processState.pauseResolve = resolve;
  });
}

// ── Handlers IPC de controle ──────────────────────────────────────────────────
ipcMain.on("pause-process", () => {
  processState.isPaused = true;
  console.log("⏸ Processo pausado.");
});

ipcMain.on("resume-process", () => {
  processState.isPaused = false;
  if (processState.pauseResolve) {
    processState.pauseResolve();   // desbloqueio do checkPause()
    processState.pauseResolve = null;
  }
  console.log("▶ Processo retomado.");
});

ipcMain.on("cancel-process", () => {
  processState.isCancelled = true;
  // Desbloqueio em caso de estar pausado (para não ficar travado)
  if (processState.pauseResolve) {
    processState.pauseResolve();
    processState.pauseResolve = null;
  }
  // Mata o processo yt-dlp em andamento
  if (processState.abortController) {
    processState.abortController.abort();
  }
  console.log("✕ Processo cancelado.");
});

// ── Janela ────────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

function send(channel, data) {
  if (mainWindow) mainWindow.webContents.send(channel, data);
}

function sendStatus(msg) {
  if (mainWindow) mainWindow.webContents.send("status", msg);
}

// ── Selecionar pasta ──────────────────────────────────────────────────────────
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ── Selecionar arquivos ───────────────────────────────────────────────────────
ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Áudio", extensions: ["mp3", "m4a", "flac", "wav"] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// ── Organizar arquivos locais ─────────────────────────────────────────────────
ipcMain.handle("organize-files", async (event, filePaths, destRoot) => {
  resetProcessState();
  const logger = new Logger((msg) => send("log", msg));
  const results = [];
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
    // Pausa
    await checkPause();
    // Cancelamento
    if (processState.isCancelled) {
      logger.info("✕ Operação cancelada pelo usuário.");
      break;
    }

    const filePath = filePaths[i];
    sendStatus(`📂 Processando ${i + 1}/${total}: ${path.basename(filePath)}`);
    logger.info(`Processando: ${path.basename(filePath)}`);
    const result = await Organizer.organize(filePath, destRoot);
    results.push(result);
    send("progress", Math.round(((i + 1) / total) * 100));
    if (result.success) {
      logger.success(`Organizado em: ${result.newPath}`);
    } else {
      logger.error(`Erro em ${path.basename(filePath)}: ${result.errors.join(", ")}`);
    }
  }

  sendStatus(processState.isCancelled ? "✕ Cancelado." : "✅ Finalizado!");
  return results;
});

// ── Importar do YouTube / Busca por nome ─────────────────────────────────────
ipcMain.handle("import-from-source", async (event, source, destRoot, customFolder) => {
  resetProcessState();
  const logger = new Logger((msg) => send("log", msg));

  try {
    if (!source || !source.trim()) {
      throw new Error("Nenhuma URL ou nome informado. Preencha o campo antes de importar.");
    }
    if (!destRoot) {
      throw new Error("Nenhuma pasta de destino selecionada. Escolha onde salvar as músicas.");
    }

    const lines = source.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    const allResults = [];
    const tempDir = app.getPath("temp");

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      // Pausa entre músicas
      await checkPause();
      if (processState.isCancelled) {
        logger.info("✕ Operação cancelada pelo usuário.");
        break;
      }

      const lineSource = lines[lineIdx];
      sendStatus(`⏳ Analisando (${lineIdx + 1}/${lines.length}): ${lineSource.substring(0, 50)}...`);

      const isSearchQuery =
        !lineSource.startsWith("http") &&
        !lineSource.includes("youtube.com") &&
        !lineSource.startsWith("ytsearch");

      if (isSearchQuery) {
        logger.info(`🔍 Buscando no YouTube: "${lineSource}"`);
      } else {
        logger.info(`🔗 Processando link: ${lineSource}`);
      }

      try {
        const playlistInfo = await Downloader.getPlaylistInfo(
          lineSource,
          processState.abortController.signal
        );
        const entries = playlistInfo.entries;
        const total = entries.length;

        if (playlistInfo.isPlaylist) {
          logger.info(`📋 Playlist "${playlistInfo.title}" — ${total} música(s).`);
        }

        for (let i = 0; i < total; i++) {
          // Pausa entre músicas
          await checkPause();
          if (processState.isCancelled) {
            logger.info("✕ Cancelado durante o download.");
            break;
          }

          const entry = entries[i];
          const indexStr = `${i + 1}/${total}`;

          sendStatus(`📥 Baixando ${indexStr}: ${entry.title}`);
          logger.info(`[${indexStr}] Baixando: ${entry.title}...`);

          try {
            let items = null;
            let attempt = 1;
            const maxRetries = 3;

            while (attempt <= maxRetries) {
              // Não tenta de novo se foi cancelado durante a espera do retry
              if (processState.isCancelled) break;
              try {
                items = await Downloader.fetch(
                  entry.url,
                  tempDir,
                  { playlistTitle: playlistInfo.title, playlistIndex: entry.index },
                  processState.abortController.signal
                );
                break;
              } catch (fetchErr) {
                // Se foi um AbortError (cancelamento), propaga direto
                if (fetchErr.name === "AbortError" || processState.isCancelled) throw fetchErr;
                const isForbidden = fetchErr.message.includes("403");
                if (isForbidden && attempt < maxRetries) {
                  const waitTime = attempt * 8;
                  logger.info(`[${indexStr}] ⚠️ Bloqueio temporário (403). Aguardando ${waitTime}s...`);
                  await new Promise((r) => setTimeout(r, waitTime * 1000));
                  attempt++;
                } else {
                  throw fetchErr;
                }
              }
            }

            if (!processState.isCancelled && items && items.length > 0) {
              const item = items[0];
              sendStatus(`📂 Organizando ${indexStr}: ${item.metadata.title}`);
              logger.info(`[${indexStr}] Organizando arquivo...`);

              const result = await Organizer.organize(
                item.filePath,
                destRoot,
                item.metadata,
                item.thumbnailPath,
                customFolder || ""
              );

              allResults.push(result);
              logger[result.success ? "success" : "error"](
                result.success
                  ? `[${indexStr}] ✔ Organizado: ${result.newPath}`
                  : `[${indexStr}] ❌ Erro: ${result.errors.join(", ")}`
              );

              if (item.filePath && await fs.pathExists(item.filePath)) {
                await fs.remove(item.filePath).catch(() => {});
              }
              if (item.thumbnailPath && await fs.pathExists(item.thumbnailPath)) {
                await fs.remove(item.thumbnailPath).catch(() => {});
              }
            }
          } catch (downloadErr) {
            if (downloadErr.name === "AbortError" || processState.isCancelled) {
              // Cancelamento limpo — não logar como erro de download
              break;
            }
            logger.error(`[${indexStr}] Erro: ${downloadErr.message}`);
            allResults.push({ success: false, errors: [downloadErr.message] });
          }

          const globalProgress =
            ((lineIdx / lines.length) + ((i + 1) / total / lines.length)) * 100;
          send("progress", Math.round(globalProgress));
        }
      } catch (lineErr) {
        if (lineErr.name === "AbortError" || processState.isCancelled) {
          logger.info("✕ Download interrompido.");
          break;
        }
        logger.error(`Erro ao processar "${lineSource}": ${lineErr.message}`);
        allResults.push({ success: false, errors: [lineErr.message] });
      }

      if (processState.isCancelled) break;
    }

    send("progress", processState.isCancelled ? null : 100);
    sendStatus(processState.isCancelled ? "✕ Cancelado pelo usuário." : "✅ Finalizado!");
    return allResults;
  } catch (err) {
    if (err.name !== "AbortError") {
      sendStatus("❌ Erro!");
      logger.error(err.message);
    }
    throw err;
  }
});