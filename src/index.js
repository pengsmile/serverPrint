const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const log = require('./logger');
const { initServer } = require('./server');
const config = require('./config');

// Determine if running in development mode
const isDev = !app.isPackaged;

// Global references
let tray = null;
let mainWindow = null;
let httpServer = null;

// Log directory
const logDir = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Global error handlers
process.on('uncaughtException', (error) => {
  log.error('Uncaught Exception:', error.message);
  log.error('Stack:', error.stack);
  if (!isDev) {
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('Unhandled Rejection at:', promise);
  log.error('Reason:', reason);
});

/**
 * Create the main window (hidden by default)
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 780,
    height: 630,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load tray page
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'tray.html'));

  // Hide instead of close
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  log.info('Main window created');
}

/**
 * Create system tray
 */
function createTray() {
  // Create tray icon - use default if icon not found
  let trayIcon;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple 16x16 icon programmatically
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('PrintHelper - 打印服务');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '查看日志',
      click: () => {
        const logPath = path.join(logDir, 'main.log');
        if (fs.existsSync(logPath)) {
          shell.openPath(logPath);
        } else {
          shell.openPath(logDir);
        }
      }
    },
    { type: 'separator' },
    {
      label: '服务状态',
      submenu: [
        {
          label: '运行中',
          enabled: false
        },
        {
          label: `端口: ${config.PORT}`,
          enabled: false
        }
      ]
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  // Double click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  log.info('System tray created');
}

/**
 * Configure auto-start on login
 */
function configureAutoStart() {
  if (!isDev) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: app.getPath('exe'),
      args: ['--hidden']
    });
    log.info('Auto-start configured');
  }
}

/**
 * Start HTTP and Socket.io server
 */
function startServer() {
  // Create HTTP server
  httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'PrintHelper' }));
      return;
    }

    // Default response
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('PrintHelper Service Running');
  });

  // Initialize Socket.io
  initServer(httpServer);

  // Start server
  const PORT = config.PORT;
  httpServer.listen(PORT, () => {
    log.info('========================================');
    log.info('PrintHelper Service Started');
    log.info(`Listening on port ${PORT}`);
    log.info(`Log file: ${logDir}/main.log`);
    log.info('========================================');
  });

  return httpServer;
}

/**
 * Handle IPC messages from renderer
 */
function setupIPC() {
  ipcMain.handle('get-status', async () => {
    const printer = require('./printer');
    const defaultPrinter = await printer.getDefaultPrinter();
    const printers = await printer.getPrinters();
    return {
      running: true,
      version: '1.0.0',
      port: config.PORT,
      logPath: path.join(logDir, 'main.log'),
      defaultPrinter: defaultPrinter,
      printers: printers
    };
  });

  ipcMain.handle('get-printers', async () => {
    const printer = require('./printer');
    return await printer.getPrinters();
  });

  ipcMain.handle('open-log', async () => {
    const logPath = path.join(logDir, 'main.log');
    if (fs.existsSync(logPath)) {
      shell.openPath(logPath);
    }
    return true;
  });

  ipcMain.handle('open-log-folder', async () => {
    shell.openPath(logDir);
    return true;
  });

  log.info('IPC handlers registered');
}

// App ready
app.whenReady().then(() => {
  log.info('App ready, starting PrintHelper...');

  // Remove native menu bar
  Menu.setApplicationMenu(null);

  // Check if started with --hidden flag
  const startHidden = process.argv.includes('--hidden');

  // Setup IPC
  setupIPC();

  // Create window (but don't show if started hidden)
  createWindow();

  // Create tray
  createTray();

  // Start Socket server
  startServer();

  // Configure auto-start
  configureAutoStart();

  // Show window if not started hidden
  if (!startHidden && mainWindow) {
    mainWindow.show();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit, just hide to tray
  }
});

// Before quit
app.on('before-quit', () => {
  app.isQuitting = true;
  log.info('Application quitting...');

  if (httpServer) {
    httpServer.close(() => {
      log.info('HTTP server closed');
    });
  }
});

// Handle second instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Focus the main window if user tries to open another instance
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

module.exports = { httpServer };
