const path = require('path');
const fs = require('fs');

// Try to use electron-log, fall back to console if not available
let log;

try {
  // Try to require electron-log
  log = require('electron-log');

  // Check if we're in Electron environment
  let electron;
  try {
    electron = require('electron');
  } catch (e) {
    electron = null;
  }

  // Configure log file path
  const logDir = electron
    ? path.join(require('electron').app.getPath('userData'), 'logs')
    : path.join(process.env.APPDATA || process.env.HOME || __dirname, 'PrintHelper', 'logs');

  // Ensure log directory exists
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFilePath = path.join(logDir, 'main.log');

  log.transports.file.resolvePathFn = () => logFilePath;

  // Configure log format
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
  log.transports.console.format = '[{h}:{i}:{s}] [{level}] {text}';

  // Set log level
  log.transports.file.level = 'info';
  log.transports.console.level = 'debug';

  // Maximum log file size (5MB)
  log.transports.file.maxSize = 5 * 1024 * 1024;

} catch (error) {
  // Fallback to simple console logging
  const originalLog = console.log;
  const originalError = console.error;
  const originalInfo = console.info;

  const getTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  };

  log = {
    info: (...args) => originalInfo(`[${getTimestamp()}] [info]`, ...args),
    error: (...args) => originalError(`[${getTimestamp()}] [error]`, ...args),
    warn: (...args) => originalLog(`[${getTimestamp()}] [warn]`, ...args),
    debug: (...args) => {
      if (process.env.DEBUG) originalLog(`[${getTimestamp()}] [debug]`, ...args);
    }
  };
}

module.exports = log;
