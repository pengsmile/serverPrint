const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Get service status
  getStatus: () => ipcRenderer.invoke('get-status'),

  // Get printer list
  getPrinters: () => ipcRenderer.invoke('get-printers'),

  // Get connected clients
  getClients: () => ipcRenderer.invoke('get-clients'),

  // Listen for client changes
  onClientsChanged: (callback) => {
    const subscription = (event, value) => callback(value);
    ipcRenderer.on('clients-changed', subscription);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('clients-changed', subscription);
  },

  // Open log file
  openLog: () => ipcRenderer.invoke('open-log'),

  // Open log folder
  openLogFolder: () => ipcRenderer.invoke('open-log-folder'),

  // Platform info
  platform: process.platform
});
