const { Server } = require('socket.io');
const { Notification } = require('electron');
const printer = require('./printer');
const log = require('./logger');
const config = require('./config');
const packageJson = require('../package.json');

const PORT = config.PORT;

let io;
// 存储当前在线的客户端 Map: id -> { id, title, url, connectedAt }
const connectedClients = new Map();
let onClientChangeCallback = null;

/**
 * Initialize Socket.io server
 * @param {http.Server} httpServer - HTTP server instance
 * @param {Function} [onClientChange] - Callback when client connects/disconnects: (clients) => void
 * @returns {Server} Socket.io server instance
 */
function initServer(httpServer, onClientChange) {
  onClientChangeCallback = onClientChange;

  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    pingTimeout: 60000,
    pingInterval: 25000
  });

  log.info(`Socket.io server initialized on port ${PORT}`);

  // Handle socket connections
  io.on('connection', (socket) => {
    // Parse client info from query
    let clientInfo = {};
    try {
      if (socket.handshake.query && socket.handshake.query.clientInfo) {
        clientInfo = JSON.parse(socket.handshake.query.clientInfo);
      }
    } catch (e) {
      log.warn('Failed to parse client info:', e.message);
    }

    const clientData = {
      id: socket.id,
      title: clientInfo.title || 'Unknown Client',
      url: clientInfo.url || '',
      connectedAt: new Date().toISOString()
    };

    log.info(`Client connected: ${socket.id} (${clientData.title})`);
    
    // Add client and notify
    connectedClients.set(socket.id, clientData);
    notifyClientChange();

    // Handle print request
    socket.on('print', async (data) => {
      log.info(`Received print request from ${socket.id}`);
      log.debug('Print data:', JSON.stringify(data).substring(0, 200));

      try {
        const result = await printer.printHTML({
          html: data.html,
          printer: data.printer,
          copies: data.copies || 1,
          pageSize: data.pageSize,
          margins: data.margins
        });

        socket.emit('printResult', result);
        log.info(`Print result for ${socket.id}:`, result);

        if (result.success) {
          new Notification({
            title: '打印任务已发送',
            body: `已发送至打印机: ${result.printer || data.printer || '默认打印机'}`
          }).show();
        } else {
          new Notification({
            title: '打印任务失败，请检查打印机',
            body: `打印机: ${result.printer || data.printer || '默认打印机'}`
          }).show();
        }
      } catch (error) {
        const errorResult = {
          success: false,
          message: error.message
        };
        socket.emit('printResult', errorResult);
        log.error(`Print error for ${socket.id}:`, error.message);
      }
    });

    // Handle printer list request
    socket.on('printers', async () => {
      const printers = await printer.getPrinters();
      socket.emit('printers', printers);
      log.info(`Sent printer list to ${socket.id}:`, printers);
    });

    // Handle raw printer list request
    socket.on('rawPrinters', async () => {
      const rawPrinters = await printer.getPrintersAsync();
      socket.emit('rawPrinters', rawPrinters);
      log.info(`Sent raw printer list to ${socket.id}`);
    });

    // Handle status request
    socket.on('status', async () => {
      const defaultPrinter = await printer.getDefaultPrinter();
      const printers = await printer.getPrinters();
      const status = {
        running: true,
        version: packageJson.version,
        defaultPrinter: defaultPrinter,
        printers: printers,
        port: PORT
      };
      socket.emit('status', status);
      log.info(`Sent status to ${socket.id}:`, status);
    });

    // Handle printer status request
    socket.on('printerStatus', async (printerName) => {
      const status = await printer.getPrinterStatus(printerName);
      socket.emit('printerStatus', status);
      log.info(`Sent printer status for ${printerName}:`, status);
    });

    // Handle printer papers request
    socket.on('printerPapers', async (printerName) => {
      const papers = await printer.getPrinterPapers(printerName);
      socket.emit('printerPapers', papers);
      log.info(`Sent papers for ${printerName}:`, papers);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      log.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
      
      // Remove client and notify
      connectedClients.delete(socket.id);
      notifyClientChange();
    });

    // Handle errors
    socket.on('error', (error) => {
      log.error(`Socket error for ${socket.id}:`, error.message);
    });
  });

  return io;
}

/**
 * Notify callback about client changes
 */
function notifyClientChange() {
  if (onClientChangeCallback) {
    onClientChangeCallback(Array.from(connectedClients.values()));
  }
}

/**
 * Get Socket.io server instance
 * @returns {Server|null} Socket.io server instance
 */
function getIO() {
  return io;
}

/**
 * Get connected clients
 * @returns {Array<Object>} List of client objects
 */
function getConnectedClients() {
  return Array.from(connectedClients.values());
}

module.exports = {
  initServer,
  getIO,
  getConnectedClients
};
