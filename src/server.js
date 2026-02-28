const { Server } = require('socket.io');
const printer = require('./printer');
const log = require('./logger');

const PORT = process.env.PORT || 8765;

let io;

/**
 * Initialize Socket.io server
 * @param {http.Server} httpServer - HTTP server instance
 * @returns {Server} Socket.io server instance
 */
function initServer(httpServer) {
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
    log.info(`Client connected: ${socket.id}`);

    // Handle print request
    socket.on('print', async (data) => {
      log.info(`Received print request from ${socket.id}`);
      log.debug('Print data:', JSON.stringify(data).substring(0, 200));

      try {
        const result = await printer.printHTML({
          html: data.html,
          printer: data.printer,
          copies: data.copies || 1
        });

        socket.emit('printResult', result);
        log.info(`Print result for ${socket.id}:`, result);
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

    // Handle status request
    socket.on('status', async () => {
      const defaultPrinter = await printer.getDefaultPrinter();
      const printers = await printer.getPrinters();
      const status = {
        running: true,
        version: '1.0.0',
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

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      log.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
    });

    // Handle errors
    socket.on('error', (error) => {
      log.error(`Socket error for ${socket.id}:`, error.message);
    });
  });

  return io;
}

/**
 * Get Socket.io server instance
 * @returns {Server|null} Socket.io server instance
 */
function getIO() {
  return io;
}

/**
 * Broadcast message to all connected clients
 * @param {string} event - Event name
 * @param {any} data - Data to broadcast
 */
function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

module.exports = {
  initServer,
  getIO,
  broadcast,
  PORT
};
