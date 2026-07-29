const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  organizeFiles: (filePaths, dest) => ipcRenderer.invoke("organize-files", filePaths, dest),
  importFromSource: (source, dest, customFolder) => ipcRenderer.invoke("import-from-source", source, dest, customFolder),
  onLog: (callback) => ipcRenderer.on("log", (event, msg) => callback(msg)),
  onProgress: (callback) => ipcRenderer.on("progress", (event, value) => callback(value)),
  onStatus: (callback) => ipcRenderer.on("status", (event, msg) => callback(msg)),
});