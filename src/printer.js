const { exec } = require('child_process');
const { BrowserWindow } = require('electron');
const log = require('./logger');

/**
 * Execute PowerShell command and return promise
 */
function execPowerShell(command) {
  return new Promise((resolve, reject) => {
    // Force UTF-8 encoding for PowerShell output to handle non-ASCII characters correctly
    const psCommand = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${command}`;
    exec(`powershell -Command "${psCommand}"`, { encoding: 'utf8' }, (error, stdout, stderr) => {
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
      isDefault: p.Default === true,
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
 * @param {Object} options.margins - Margin settings (optional)
 * @param {string|Object} options.pageSize - Page size (optional)
 * @returns {Promise<Object>} Print result
 */
async function printHTML(options) {
  const { 
    html, 
    printer: printerName, 
    copies = 1, 
    pageSize, 
    margins = { marginType: 'default' } 
  } = options;

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
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>@media print{body{margin:0;padding:0}}@page{margin:0}.hiprint-printPaper *{box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box}.hiprint-printPaper :focus{outline:0 auto -webkit-focus-ring-color}.hiprint-printPaper{overflow-x:hidden;overflow:hidden;padding:0;page-break-after:always;position:relative;-webkit-user-select:none;-moz-user-select:none;user-select:none}.hiprint-printPaper .hiprint-printPaper-content{position:relative}@-moz-document url-prefix(){.hiprint-printPaper .hiprint-printPaper-content{margin-top:20px;position:relative;top:-20px}}.hiprint-printPaper.design{overflow:visible}.hiprint-printTemplate .hiprint-printPanel{page-break-after:always}.hiprint-printPaper,hiprint-printPanel{border:0;box-sizing:border-box}.hiprint-printPanel .hiprint-printPaper:last-child,.hiprint-printTemplate .hiprint-printPanel:last-child{page-break-after:avoid}.hiprint-printPaper .hidefooterLinetarget,.hiprint-printPaper .hideheaderLinetarget{border-top:0 dashed #c9bebe!important}.hiprint-printPaper.design{border:1px dashed hsla(0,0%,67%,.7)}.design .hiprint-printElement-longText-content,.design .hiprint-printElement-table-content{box-sizing:border-box;overflow:hidden}.design .resize-panel{box-sizing:border-box}.hiprint-printElement-text{background-color:transparent;background-repeat:repeat;border:.75pt #000;box-sizing:border-box;direction:ltr;font-family:SimSun;font-size:9pt;font-style:normal;font-weight:400;line-height:9.75pt;padding:0;text-align:left;text-decoration:none;word-wrap:break-word;word-break:break-all}.design .hiprint-printElement-text-content{border:1px dashed var(--hiprint-border);box-sizing:border-box}.hiprint-printElement-longText{border:.75pt #000;word-wrap:break-word;word-break:break-all}.hiprint-printElement-longText,.hiprint-printElement-table{background-color:transparent;background-repeat:repeat;box-sizing:border-box;direction:ltr;font-family:SimSun;font-size:9pt;font-style:normal;font-weight:400;line-height:9.75pt;padding:0;text-align:left;text-decoration:none}.hiprint-printElement-table{border-color:#000;border-style:none;color:#000}.hiprint-printElement-table thead{background:#e8e8e8;font-weight:700}table.hiprint-printElement-tableTarget{width:100%}.hiprint-printElement-tableTarget,.hiprint-printElement-tableTarget td,.hiprint-printElement-tableTarget tr{border-color:#000;box-sizing:border-box;direction:ltr;font-weight:400;padding:0 4pt;text-decoration:none;vertical-align:middle;word-wrap:break-word;word-break:break-all}.hiprint-printElement-tableTarget-border-all{border:1px solid}.hiprint-printElement-tableTarget-border-none{border:0 solid}.hiprint-printElement-tableTarget-border-lr{border-left:1px solid;border-right:1px solid}.hiprint-printElement-tableTarget-border-left{border-left:1px solid}.hiprint-printElement-tableTarget-border-right{border-right:1px solid}.hiprint-printElement-tableTarget-border-tb{border-bottom:1px solid;border-top:1px solid}.hiprint-printElement-tableTarget-border-top{border-top:1px solid}.hiprint-printElement-tableTarget-border-bottom{border-bottom:1px solid}.hiprint-printElement-tableTarget-border-td-none td{border:0 solid}.hiprint-printElement-tableTarget-border-td-all td:not(:nth-last-child(-n+2)),.hiprint-printElement-tableTarget-border-td-all td:not(last-child){border-right:1px solid}.hiprint-printElement-tableTarget-border-td-all td:last-child{border-left:1px solid}.hiprint-printElement-tableTarget-border-td-all td:last-child:first-child{border-left:none}.hiprint-printElement-tableTarget td{height:18pt}.hiprint-printPaper .hiprint-paperNumber{font-size:9pt}.hiprint-printElement-table-handle{background:red;height:0;position:absolute;width:0;z-index:1}.hiprint-printPaper .hiprint-paperNumber-disabled{color:#dcdcdc!important;float:right!important;right:0!important}.hiprint-printElement-hline,.hiprint-printElement-vline{border:0 #000}.hiprint-printElement-vline{border-left:.75pt solid #000;border-top:0 #000!important}.hiprint-printElement-hline,.hiprint-printElement-vline{border-bottom:0 #000!important;border-right:0 #000!important}.hiprint-printElement-hline{border-left:0 #000!important;border-top:.75pt solid #000}.hiprint-printElement-oval,.hiprint-printElement-rect{border:.75pt solid #000}.hiprint-text-content-middle>div{align-items:center;display:grid}.hiprint-text-content-bottom>div{align-items:flex-end;display:grid}.hiprint-text-content-wrap .hiprint-text-content-wrap-nowrap{white-space:nowrap}.hiprint-text-content-wrap .hiprint-text-content-wrap-clip{overflow:hidden;text-overflow:clip;white-space:nowrap}.hiprint-text-content-wrap .hiprint-text-content-wrap-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hi-grid-row{height:auto;margin-left:0;margin-right:0;position:relative;zoom:1;box-sizing:border-box;display:block}.hi-grid-row:after,.hi-grid-row:before{box-sizing:border-box;content:"";display:table}.hi-grid-col{box-sizing:border-box;display:block;flex:0 0 auto;float:left;position:relative}.table-grid-row{margin-left:0;margin-right:0}.tableGridColumnsGutterRow{padding-left:0;padding-right:0}.hiprint-gridColumnsFooter{clear:both;text-align:left}</style>
      </head>
      <body>
        ${html}
      </body>
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

    // Prepare print options according to Electron 28.x API
    const printOptions = {
      silent: true,
      printBackground: true,
      deviceName: targetPrinter,
      copies: copies,
      // Modern API: margins is an object with marginType as string
      margins: {
        marginType: (margins && margins.marginType) ? margins.marginType : 'default'
      }
    };

    // If custom, convert pixels to microns (1px ≈ 264.58 microns at 96 DPI)
    if (margins && printOptions.margins.marginType === 'custom') {
      const pxToMicrons = (px) => Math.round((px || 0) * 264.58);
      printOptions.margins.top = pxToMicrons(margins.top);
      printOptions.margins.bottom = pxToMicrons(margins.bottom);
      printOptions.margins.left = pxToMicrons(margins.left);
      printOptions.margins.right = pxToMicrons(margins.right);
    }

    // Only add pageSize if it's explicitly provided
    if (pageSize) {
      printOptions.pageSize = pageSize;
    }

    log.info(`Final print options:`, JSON.stringify(printOptions, null, 2));

    // Print directly using Electron's webContents.print
    await new Promise((resolve, reject) => {
      // Set a timeout to prevent hanging
      const timeout = setTimeout(() => {
        reject(new Error('Print operation timed out after 30s'));
      }, 30000);

      printWindow.webContents.print(printOptions, (success, errorType, errorMessage) => {
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
      jobId: Date.now().toString(),
      printer: targetPrinter
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

/**
 * Get raw printer list from Electron's getPrintersAsync
 * @returns {Promise<Array<Electron.PrinterInfo>>} List of printer info from Electron
 */
async function getPrintersAsync() {
  try {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true
      }
    });
    const printers = await win.webContents.getPrintersAsync();
    win.destroy();
    return printers;
  } catch (error) {
    log.error('Failed to get printers via Electron:', error.message);
    return [];
  }
}

/**
 * Get supported paper sizes for a specific printer via PowerShell (using WMI)
 * @param {string} printerName - The name of the printer
 * @returns {Promise<Array<string>>} List of supported paper names
 */
async function getPrinterPapers(printerName) {
  try {
    if (!printerName) return [];
    
    // Use WMI to get printer paper names
    // Fix: Use Where-Object instead of -Filter to avoid WQL syntax errors with special characters (like parentheses) in printer names
    const command = `Get-WmiObject -Class Win32_Printer | Where-Object { $_.Name -eq '${printerName}' } | Select-Object -ExpandProperty PrinterPaperNames`;

    const output = await execPowerShell(command);
    if (!output) return [];

    // Split by newlines and trim
    return output.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
  } catch (error) {
    log.error(`Failed to get papers for printer ${printerName}:`, error.message);
    return [];
  }
}

module.exports = {
  getPrinters,
  getPrintersAsync,
  getDefaultPrinter,
  printHTML,
  getPrinterStatus,
  getPrinterPapers,
  getPrintersSync,
  getDefaultPrinterSync
};
