const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs-extra");
const Organizer = require("./modules/organizer");
const Downloader = require("./modules/downloader");
const Logger = require("./modules/logger");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 640,
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

// 🔥 NOVO: envia status para a interface
function sendStatus(msg) {
  if (mainWindow) mainWindow.webContents.send("status", msg);
}

// Seleciona a pasta de destino (ex: pendrive)
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Seleciona arquivos de áudio locais para organizar
ipcMain.handle("select-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Áudio", extensions: ["mp3", "m4a", "flac", "wav"] }],
  });
  if (result.canceled) return [];
  return result.filePaths;
});

// Organiza arquivos locais já selecionados pelo usuário
ipcMain.handle("organize-files", async (event, filePaths, destRoot) => {
  const logger = new Logger((msg) => send("log", msg));
  const results = [];
  const total = filePaths.length;

  for (let i = 0; i < total; i++) {
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
  sendStatus("✅ Finalizado!");
  return results;
});

// Importar de uma fonte externa (ex: YouTube)
ipcMain.handle("import-from-source", async (event, source, destRoot, customFolder) => {
  const logger = new Logger((msg) => send("log", msg));
  try {
    // Validações básicas antes de qualquer coisa
    if (!source || !source.trim()) {
      throw new Error("Nenhuma URL informada. Cole o link do YouTube antes de importar.");
    }
    if (!destRoot) {
      throw new Error("Nenhuma pasta de destino selecionada. Escolha onde salvar as músicas.");
    }

    sendStatus("⏳ Analisando link...");
    logger.info("Obtendo metadados rápidos da fonte...");
    const playlistInfo = await Downloader.getPlaylistInfo(source);
    
    const entries = playlistInfo.entries;
    const total = entries.length;
    const results = [];

    if (playlistInfo.isPlaylist) {
      logger.info(`📋 Playlist "${playlistInfo.title}" detectada com ${total} músicas.`);
    } else {
      logger.info(`🎵 Música única detectada.`);
    }

    const tempDir = app.getPath("temp");

    for (let i = 0; i < total; i++) {
      const entry = entries[i];
      const indexStr = `${i + 1}/${total}`;
      
      sendStatus(`📥 Baixando ${indexStr}: ${entry.title}`);
      logger.info(`[${indexStr}] Baixando áudio: ${entry.title}...`);

      try {
        let items = null;
        let retries = 3;
        let attempt = 1;

        while (attempt <= retries) {
          try {
            // Baixa apenas o vídeo individual da vez
            items = await Downloader.fetch(entry.url, tempDir, {
              playlistTitle: playlistInfo.title,
              playlistIndex: entry.index
            });
            break; // Se deu certo, sai do loop de tentativas
          } catch (fetchErr) {
            const isForbidden = fetchErr.message.includes('403');
            if (isForbidden && attempt < retries) {
              const waitTime = attempt * 8; // Aumenta o tempo de espera a cada erro (8s, 16s...)
              logger.info(`[${indexStr}] ⚠️ Bloqueio temporário (403). Aguardando ${waitTime}s antes da tentativa ${attempt + 1}/${retries}...`);
              await new Promise(r => setTimeout(r, waitTime * 1000));
              attempt++;
            } else {
              throw fetchErr; // Se não for 403 ou excedeu tentativas, propaga o erro
            }
          }
        }

        if (items && items.length > 0) {
          const item = items[0]; // Só há 1 item por download individual
          sendStatus(`📂 Organizando ${indexStr}: ${item.metadata.title}`);
          logger.info(`[${indexStr}] Organizando arquivo...`);

          const result = await Organizer.organize(
            item.filePath,
            destRoot,
            item.metadata,
            item.thumbnailPath,
            customFolder || '' // Pasta personalizada do usuário
          );

          results.push(result);

          logger[result.success ? "success" : "error"](
            result.success ? `[${indexStr}] Organizado: ${result.newPath}` : `[${indexStr}] Erro: ${result.errors.join(", ")}`
          );

          // Remover arquivos temporários residuais
          if (item.filePath && await fs.pathExists(item.filePath)) {
            await fs.remove(item.filePath).catch(() => {});
          }
          if (item.thumbnailPath && await fs.pathExists(item.thumbnailPath)) {
            await fs.remove(item.thumbnailPath).catch(() => {});
          }
        }
      } catch (downloadErr) {
        logger.error(`[${indexStr}] Erro ao processar: ${downloadErr.message}`);
        results.push({ success: false, errors: [downloadErr.message] });
      }

      send("progress", Math.round(((i + 1) / total) * 100));
    }

    sendStatus("✅ Finalizado!");
    return results;
  } catch (err) {
    sendStatus("❌ Erro!");
    logger.error(err.message);
    throw err;
  }
});