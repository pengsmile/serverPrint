const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  shell,
  nativeImage,
  dialog,
} = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");
const log = require("./logger");
const { initServer, getConnectedClients } = require("./server");
const config = require("./config");
const updater = require("./updater");
const packageJson = require("../package.json");

// Determine if running in development mode
const isDev = !app.isPackaged;

// Set App User Model ID for Windows
app.setAppUserModelId("com.printhelper.app");

// Global references
let tray = null;
let mainWindow = null;
let httpServer = null;
let forceUpdatePending = false;

// Log directory
const logDir = path.join(app.getPath("userData"), "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Global error handlers
process.on("uncaughtException", (error) => {
  log.error("Uncaught Exception:", error.message);
  log.error("Stack:", error.stack);
  if (!isDev) {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason, promise) => {
  log.error("Unhandled Rejection at:", promise);
  log.error("Reason:", reason);
});

async function loadRenderer() {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;

  if (isDev && devServerUrl) {
    try {
      await mainWindow.loadURL(devServerUrl);
      return;
    } catch (error) {
      log.error("Failed to load Vite dev server:", error.message);
    }
  }

  await mainWindow.loadFile(
    path.join(__dirname, "renderer-dist", "index.html"),
  );
}

/**
 * Create the main window (hidden by default)
 */
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 1050,
    show: false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    icon: path.join(__dirname, "..", "assets", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  await loadRenderer();

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  // Hide instead of close (block close during force update)
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      if (forceUpdatePending) {
        dialog.showMessageBoxSync(mainWindow, {
          type: "warning",
          title: "强制更新",
          message: "当前版本需要强制更新，请点击立即安装完成更新。",
          buttons: ["确定"],
        });
      } else {
        mainWindow.hide();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  log.info("Main window created");
}

/**
 * Create system tray
 */
function createTray() {
  let trayIcon;
  const iconPath = path.join(__dirname, "..", "assets", "icon.png");

  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    // trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("PrintHelper - 打印服务");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开主界面",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "查看日志",
      click: () => {
        const logPath = path.join(logDir, "main.log");
        if (fs.existsSync(logPath)) {
          shell.openPath(logPath);
        } else {
          shell.openPath(logDir);
        }
      },
    },
    { type: "separator" },
    {
      label: "服务状态",
      submenu: [
        {
          label: "运行中",
          enabled: false,
        },
        {
          label: `端口: ${config.PORT}`,
          enabled: false,
        },
      ],
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        if (forceUpdatePending) {
          // Block tray quit during force update, show window instead
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          dialog.showMessageBox(mainWindow, {
            type: "warning",
            title: "强制更新",
            message: "当前版本需要强制更新，请点击立即安装完成更新后才能退出。",
            buttons: ["确定"],
          });
          return;
        }
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 双击托盘图标打开主界面
  tray.on("double-click", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  log.info("System tray created");
}

/**
 * Configure auto-start on login
 */
function configureAutoStart() {
  if (!isDev) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: app.getPath("exe"),
      args: ["--hidden"],
    });
    log.info("Auto-start configured");
  }
}

/**
 * Start HTTP and Socket.io server
 */
function startServer() {
  // Create HTTP server
  httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "PrintHelper" }));
      return;
    }

    // Default response
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("PrintHelper Service Running");
  });

  // Initialize Socket.io with client change callback
  initServer(httpServer, (clients) => {
    // Notify renderer process about client changes
    if (mainWindow) {
      mainWindow.webContents.send("clients-changed", clients);
    }
  });

  // Start server
  const PORT = config.PORT;
  httpServer.listen(PORT, () => {
    log.info("========================================");
    log.info("PrintHelper Service Started");
    log.info(`Listening on port ${PORT}`);
    log.info(`Log file: ${logDir}/main.log`);
    log.info("========================================");
  });

  return httpServer;
}

/**
 * Handle IPC messages from renderer
 */
function setupIPC() {
  ipcMain.handle("get-status", async () => {
    const printer = require("./printer");
    const defaultPrinter = await printer.getDefaultPrinter();
    const printers = await printer.getPrinters();
    const connectedClients = getConnectedClients();

    return {
      running: true,
      version: packageJson.version,
      port: config.PORT,
      logPath: path.join(logDir, "main.log"),
      defaultPrinter: defaultPrinter,
      printers: printers,
      clientCount: connectedClients.length,
      clients: connectedClients,
    };
  });

  ipcMain.handle("get-printers", async () => {
    const printer = require("./printer");
    return await printer.getPrinters();
  });

  ipcMain.handle("get-clients", async () => {
    return getConnectedClients();
  });

  ipcMain.handle("open-log", async () => {
    const logPath = path.join(logDir, "main.log");
    if (fs.existsSync(logPath)) {
      shell.openPath(logPath);
    }
    return true;
  });

  ipcMain.handle("open-log-folder", async () => {
    shell.openPath(logDir);
    return true;
  });

  ipcMain.handle("get-update-state", async () => {
    return updater.getState();
  });

  ipcMain.handle("check-update", async () => {
    return updater.checkForUpdates({ source: "manual" });
  });

  ipcMain.handle("download-update", async () => {
    return updater.downloadUpdate();
  });

  ipcMain.handle("install-update", async () => {
    // Clear force update flag before installing to prevent before-quit from blocking exit
    forceUpdatePending = false;
    app.isQuitting = true;
    return updater.installUpdate();
  });

  log.info("IPC handlers registered");
}

// Quit when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Don't quit, just hide to tray
  }
});

// Before quit (block quit during force update unless installing)
app.on("before-quit", (event) => {
  if (forceUpdatePending && !app.isQuitting) {
    event.preventDefault();
    log.info("Quit blocked: force update pending");
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
    return;
  }

  app.isQuitting = true;
  log.info("Application quitting...");

  if (httpServer) {
    httpServer.close(() => {
      log.info("HTTP server closed");
    });
  }
});

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // App ready
  app.whenReady().then(() => {
    log.info("App ready, starting PrintHelper...");

    // Remove native menu bar
    Menu.setApplicationMenu(null);

    // Check if started with --hidden flag
    const startHidden = process.argv.includes("--hidden");

    // Setup IPC
    setupIPC();

    updater.setStateListener((updateState) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("update-state-changed", updateState);
      }
    });

    // Handle force update: show window and block quit
    updater.setForceUpdateListener((updateState) => {
      forceUpdatePending = true;
      log.info("Force update ready, showing main window for installation...");

      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    // Create window (but don't show if started hidden)
    createWindow().catch((error) => {
      log.error("Failed to create main window:", error.message);
    });

    // Create tray
    createTray();

    // Start Socket server
    startServer();

    // Configure auto-start
    configureAutoStart();

    // Clean up old installer files from previous updates
    updater.cleanDownloadDirectory();

    if (config.UPDATE_ENABLED && config.UPDATE_AUTO_CHECK_ON_START) {
      setTimeout(() => {
        updater.checkForUpdates({ source: "startup" }).catch((error) => {
          log.error("Startup update check failed:", error.message);
        });
      }, config.UPDATE_AUTO_CHECK_DELAY_MS);
    }

    // Show window if not started hidden
    if (!startHidden && mainWindow) {
      mainWindow.show();
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow().catch((error) => {
          log.error("Failed to recreate main window:", error.message);
        });
      }
    });
  });
}

module.exports = { httpServer };
