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

function sendProgress({ percent, completed, total, failed }) {
  send("progress", { percent, completed, total, failed });
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
  let completedCount = 0;
  let failedCount = 0;

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
    if (result.success) {
      completedCount++;
      logger.success(`Organizado em: ${result.newPath}`);
    } else {
      failedCount++;
      logger.error(`Erro em ${path.basename(filePath)}: ${result.errors.join(", ")}`);
    }
    sendProgress({
      percent: Math.round(((completedCount + failedCount) / total) * 100),
      completed: completedCount,
      total,
      failed: failedCount,
    });
  }

  sendStatus(
    processState.isCancelled
      ? `✕ Cancelado — ${completedCount}/${total} concluído(s).`
      : `✅ Finalizado — ${completedCount}/${total} concluído(s)${failedCount ? `, ${failedCount} falha(s)` : ""}.`
  );
  sendProgress({
    percent: 100,
    completed: completedCount,
    total,
    failed: failedCount,
  });
  return results;
});

// ── Detectar URLs de playlist dinâmica (Mix/Rádio) ───────────────────────────
ipcMain.handle("check-dynamic-playlists", (event, source) => {
  if (!source || !source.trim()) return [];
  return source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && Downloader.isDynamicPlaylistUrl(l));
});

// ── Detectar formatos disponíveis (sem baixar) ────────────────────────────────
ipcMain.handle("get-available-formats", async (event, url) => {
  try {
    return await Downloader.getAvailableFormats(url);
  } catch (err) {
    console.warn("⚠️ Falha ao detectar formatos:", err.message);
    return { resolutions: [], title: null };
  }
});

// ── Importar do YouTube / Busca por nome ─────────────────────────────────────
ipcMain.handle("import-from-source", async (event, source, destRoot, customFolder, downloadOpts) => {
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
    let grandTotal = 0;
    let completedCount = 0;
    let failedCount = 0;

    const reportProgress = () => {
      const processed = completedCount + failedCount;
      sendProgress({
        percent: grandTotal > 0 ? Math.round((processed / grandTotal) * 100) : 0,
        completed: completedCount,
        total: grandTotal,
        failed: failedCount,
      });
    };

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
        if (Downloader.isDynamicPlaylistUrl(lineSource)) {
          logger.warn(
            "Playlist dinâmica (Mix/Rádio) detectada — o total de faixas pode ser maior que o exibido inicialmente."
          );
        }
      }

      try {
        const playlistInfo = await Downloader.getPlaylistInfo(
          lineSource,
          processState.abortController.signal
        );
        const entries = playlistInfo.entries;
        const total = entries.length;
        grandTotal += total;

        if (playlistInfo.isPlaylist) {
          logger.info(`📋 Playlist "${playlistInfo.title}" — ${total} música(s).`);
        }
        reportProgress();

        for (let i = 0; i < total; i++) {
          // Pausa entre músicas
          await checkPause();
          if (processState.isCancelled) {
            logger.info("✕ Cancelado durante o download.");
            break;
          }

          const entry = entries[i];
          const itemNum = completedCount + failedCount + 1;
          const indexStr = `${itemNum}/${grandTotal}`;

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
                  { playlistTitle: playlistInfo.title, playlistIndex: entry.index, downloadOpts },
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
                  const isUnavailable = fetchErr.message.includes('Video unavailable') ||
                                        fetchErr.message.includes('blocked') ||
                                        fetchErr.message.includes('account has been terminated') ||
                                        fetchErr.message.includes('This video is not available') ||
                                        fetchErr.message.includes('Sign in to confirm your age') ||
                                        fetchErr.message.includes('removed for violating') ||
                                        fetchErr.message.includes('Private video') ||
                                        fetchErr.message.includes('has been removed');

                  if (isUnavailable) {
                    logger.info(`[${indexStr}] 🔍 Fallback: buscando "${entry.title}" no YouTube...`);
                    const { artist, track } = Downloader.extractArtistAndTitle(entry.title);
                    const searchQuery = track || entry.title;
                    
                    try {
                      const searchUrl = `ytsearch1:"${searchQuery}"`;
                      items = await Downloader.fetch(
                        searchUrl, 
                        tempDir,
                        { playlistTitle: playlistInfo.title, playlistIndex: entry.index, downloadOpts },
                        processState.abortController.signal
                      );
                      logger.info(`[${indexStr}] ✅ Fallback encontrado: ${items[0].metadata.title}`);
                      
                      if (items && items.length > 0) {
                        items[0].metadata.fallbackTitle = entry.title;
                        items[0].metadata.originalUrl = entry.url;
                      }
                      break;
                    } catch (fallbackError) {
                      logger.warn(`[${indexStr}] ❌ Fallback falhou para "${entry.title}": ${fallbackError.message}`);
                      throw fallbackError;
                    }
                  } else {
                    throw fetchErr;
                  }
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
                customFolder || "",
                downloadOpts
              );

              allResults.push(result);
              if (result.success) {
                completedCount++;
                logger.success(`[${indexStr}] ✔ Organizado: ${result.newPath}`);
              } else {
                failedCount++;
                logger.error(`[${indexStr}] ❌ Erro: ${result.errors.join(", ")}`);
              }

              if (item.filePath && await fs.pathExists(item.filePath)) {
                await fs.remove(item.filePath).catch(() => {});
              }
              if (item.thumbnailPath && await fs.pathExists(item.thumbnailPath)) {
                await fs.remove(item.thumbnailPath).catch(() => {});
              }
            } else if (!processState.isCancelled) {
              failedCount++;
              const errMsg = "Download não retornou arquivo.";
              logger.error(`[${indexStr}] ${errMsg}`);
              allResults.push({ success: false, errors: [errMsg] });
            }
          } catch (downloadErr) {
            if (downloadErr.name === "AbortError" || processState.isCancelled) {
              // Cancelamento limpo — não logar como erro de download
              break;
            }
            failedCount++;
            logger.error(`[${indexStr}] Erro: ${downloadErr.message}`);
            allResults.push({ success: false, errors: [downloadErr.message] });
          }

          reportProgress();
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

    if (processState.isCancelled) {
      sendProgress({
        percent: grandTotal > 0 ? Math.round(((completedCount + failedCount) / grandTotal) * 100) : 0,
        completed: completedCount,
        total: grandTotal,
        failed: failedCount,
      });
    } else {
      sendProgress({
        percent: 100,
        completed: completedCount,
        total: grandTotal,
        failed: failedCount,
      });
    }
    sendStatus(
      processState.isCancelled
        ? `✕ Cancelado — ${completedCount}/${grandTotal} concluído(s).`
        : `✅ Finalizado — ${completedCount}/${grandTotal} concluído(s)${failedCount ? `, ${failedCount} falha(s)` : ""}.`
    );
    return allResults;
  } catch (err) {
    if (err.name !== "AbortError") {
      sendStatus("❌ Erro!");
      logger.error(err.message);
    }
    throw err;
  }
});

// ── Renumerar pasta (apenas renomear, sem mover) ──────────────────────────────
ipcMain.handle("renumber-folder", async (event, folderPath) => {
  const logger = new Logger((msg) => send("log", msg));
  try {
    logger.info(`🔢 Renumerando arquivos em: ${folderPath}`);
    const result = await Organizer.renumberFolder(folderPath);
    if (result.success) {
      logger.success(`✅ ${result.renamed} arquivo(s) renumerado(s) com sucesso.`);
    } else {
      result.errors.forEach(e => logger.error(`❌ ${e}`));
    }
    sendStatus(result.success ? "✅ Renumeração concluída!" : "⚠️ Renumeração com erros.");
    return result;
  } catch (err) {
    logger.error(`❌ Erro: ${err.message}`);
    sendStatus("❌ Erro na renumeração!");
    return { success: false, renamed: 0, errors: [err.message] };
  }
});