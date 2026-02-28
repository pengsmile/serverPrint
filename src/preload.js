const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Get service status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Get printer list
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Open log file
  openLog: () => ipcRenderer.invoke('open-log'),

  // Open log folder
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),

  // Platform info
  platform: process.platform
});
