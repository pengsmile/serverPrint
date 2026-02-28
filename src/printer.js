const { exec } = require('child_process');
const { BrowserWindow } = require('electron');
const log = require('./logger');

/**
 * Execute PowerShell command and return promise
 */
function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    exec(`powershell -Command "${command}"`, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Get list of available printers
 * @returns {Promise<Array<{name: string, isDefault: boolean}>>} Array of printer objects
 */
async function getPrinters() {
  try {
    // Use WMI to get printers (more reliable for Default property)
    const output = await execPowerShell('Get-WmiObject -Class Win32_Printer | Select-Object Name, Default | ConvertTo-Json -Compress');

    if (!output || output === '') return [];

    let printers = [];
    try {
      printers = JSON.parse(output);
      // Ensure it's an array
      if (!Array.isArray(printers)) {
        printers = [printers];
      }
    } catch (e) {
      log.error('Failed to parse printers JSON:', e.message, 'Output:', output);
      return [];
    }

    const result = printers.map(p => ({
      name: p.Name || '',
      isDefault: p.Default === true
    })).filter(p => p.name !== '');

    log.info('Found printers:', result.map(p => p.name));
    return result;
  } catch (error) {
    log.error('Failed to get printers:', error.message);
    return [];
  }
}

/**
 * Get default printer
 * @returns {Promise<string|null>} Default printer name or null
 */
async function getDefaultPrinter() {
  try {
    // Get all printers with their default status
    const printers = await getPrinters();

    // Find default printer
    const defaultPrinter = printers.find(p => p.isDefault);
    if (defaultPrinter) {
      return defaultPrinter.name;
    }

    // Fallback: return first available printer
    return printers.length > 0 ? printers[0].name : null;
  } catch (error) {
    log.error('Failed to get default printer:', error.message);
    return null;
  }
}

/**
 * Print HTML content using Electron's webContents.print
 * @param {Object} options - Print options
 * @param {string} options.html - HTML content to print
 * @param {string} [options.printer] - Printer name (optional, uses default if not specified)
 * @param {number} [options.copies=1] - Number of copies
 * @returns {Promise<Object>} Print result
 */
async function printHTML(options) {
  const { html, printer: printerName, copies = 1 } = options;

  if (!html) {
    return {
      success: false,
      message: 'HTML content is required'
    };
  }

  try {
    // Determine which printer to use
    let targetPrinter = printerName;
    if (!targetPrinter) {
      targetPrinter = await getDefaultPrinter();
      if (!targetPrinter) {
        return {
          success: false,
          message: 'No default printer found'
        };
      }
    }

    log.info(`Printing to printer: ${targetPrinter}, copies: ${copies}`);

    // Create a hidden BrowserWindow to render HTML
    const printWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Wrap HTML with proper UTF-8 encoding meta tag
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  </style>
</head>
<body>${html}</body>
</html>`;

    // Explicitly handle page loading events to ensure content is ready
    const pageLoadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Page load timed out after 10s'));
      }, 10000);

      printWindow.webContents.once('did-finish-load', () => {
        clearTimeout(timeout);
        log.info('Page loaded successfully');
        resolve();
      });

      printWindow.webContents.once('did-fail-load', (event, errorCode, errorDescription) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to load content: ${errorDescription} (${errorCode})`));
      });
    });

    // Load HTML content with UTF-8 encoding
    printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
    
    // Wait for the page to finish loading
    try {
      await pageLoadPromise;
    } catch (error) {
      log.error('Page load failed:', error.message);
      printWindow.close();
      throw error;
    }

    // Print directly using Electron's webContents.print
    await new Promise((resolve, reject) => {
      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        reject(new Error('Print operation timed out after 30s'));
      }, 30000);

      printWindow.webContents.print({
        silent: true, // Use silent printing for background service
        printBackground: true,
        deviceName: targetPrinter,
        copies: copies
      }, (success, errorType, errorMessage) => {
        clearTimeout(timeout);
        if (!success) {
          log.error('Print error:', errorMessage);
          reject(new Error(errorMessage || 'Print failed'));
        } else {
          log.info('Print callback received: success');
          resolve();
        }
      });
    });

    // Wait a bit before closing to ensure data is sent to the printer spooler
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Close the window after printing
    printWindow.close();

    log.info(`Print job sent successfully to ${targetPrinter}`);

    return {
      success: true,
      message: 'Print job sent successfully',
      jobId: Date.now().toString()
    };
  } catch (error) {
    log.error('Print failed:', error.message);
    return {
      success: false,
      message: error.message
    };
  }
}

/**
 * Get printer status
 * @param {string} printerName - Printer name
 * @returns {Promise<Object>} Printer status
 */
async function getPrinterStatus(printerName) {
  try {
    const output = await execPowerShell(
      `Get-Printer -Name "${printerName}" | ConvertTo-Json -Compress`
    );

    if (!output) {
      return {
        exists: false,
        message: 'Printer not found'
      };
    }

    const info = JSON.parse(output);
    return {
      exists: true,
      name: info.Name,
      status: info.Status || 'Ready',
      isDefault: info.Default || false
    };
  } catch (error) {
    log.error('Failed to get printer status:', error.message);
    return {
      exists: false,
      message: error.message
    };
  }
}

/**
 * Synchronous versions for backward compatibility
 */
function getPrintersSync() {
  return [];
}

function getDefaultPrinterSync() {
  return null;
}

module.exports = {
  getPrinters,
  getDefaultPrinter,
  printHTML,
  getPrinterStatus,
  getPrintersSync,
  getDefaultPrinterSync
};
