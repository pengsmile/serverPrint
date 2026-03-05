const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  // Service port
  PORT: parseInt(process.env.PORT, 10) || 8765,
};

module.exports = config;
