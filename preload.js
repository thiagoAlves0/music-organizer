const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  organizeFiles: (filePaths, dest) => ipcRenderer.invoke("organize-files", filePaths, dest),
  importFromSource: (source, dest, customFolder, downloadOpts) => ipcRenderer.invoke("import-from-source", source, dest, customFolder, downloadOpts),
  checkDynamicPlaylists: (source) => ipcRenderer.invoke("check-dynamic-playlists", source),
  getAvailableFormats: (url) => ipcRenderer.invoke("get-available-formats", url),
  onLog: (callback) => ipcRenderer.on("log", (event, msg) => callback(msg)),
  onProgress: (callback) => ipcRenderer.on("progress", (event, value) => callback(value)),
  onStatus: (callback) => ipcRenderer.on("status", (event, msg) => callback(msg)),
  // Controles de processo
  pauseProcess: () => ipcRenderer.send("pause-process"),
  resumeProcess: () => ipcRenderer.send("resume-process"),
  cancelProcess: () => ipcRenderer.send("cancel-process"),
  // Renumeração
  renumberFolder: (folderPath) => ipcRenderer.invoke("renumber-folder", folderPath),
});