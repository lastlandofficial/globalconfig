const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("fixtureFinance", {
  run: (action) => ipcRenderer.invoke("fixture:finance", action),
});
