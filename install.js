const Service = require('node-windows').Service;
const path = require('path');

// Create a new service
const svc = new Service({
  name: 'PrintHelper',
  description: 'Windows printing service with Socket.io communication',
  script: path.join(__dirname, 'src', 'index.js'),
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=2048'
  ],
  // Run as local system account
  user: null,
  password: null,
  // Allow service to interact with desktop (optional, for some printers)
  allowServiceLogon: true,
  // Service start options
  startImmediately: true
});

// Handle uninstall service
const isUninstall = process.argv.includes('--uninstall');

// Handle install/uninstall
if (isUninstall) {
  console.log('Uninstalling PrintHelper service...');
  svc.on('uninstall', function() {
    console.log('PrintHelper service uninstalled successfully.');
    console.log('The service has been removed from the system.');
    process.exit(0);
  });

  svc.on('error', function(err) {
    console.error('Error uninstalling service:', err.message);
    process.exit(1);
  });

  svc.uninstall();
} else {
  console.log('Installing PrintHelper service...');
  console.log('This will set up the service to run at system startup.');

  svc.on('install', function() {
    console.log('PrintHelper service installed successfully.');
    console.log('The service is now registered and will start automatically on system boot.');
    console.log('');
    console.log('Service details:');
    console.log('  Name: PrintHelper');
    console.log('  Description: Windows printing service with Socket.io communication');
    console.log('  Script: ' + path.join(__dirname, 'src', 'index.js'));
    console.log('');
    console.log('To uninstall, run: node install.js --uninstall');

    // Start the service after installation
    svc.start();
  });

  svc.on('start', function() {
    console.log('PrintHelper service started.');
  });

  svc.on('error', function(err) {
    console.error('Error installing service:', err.message);
    console.error('Make sure you are running as Administrator.');
    process.exit(1);
  });

  svc.install();
}
