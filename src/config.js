const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const config = {
  // Service port
  PORT: parseInt(process.env.PORT, 10) || 8765,
  UPDATE_ENABLED: process.env.UPDATE_ENABLED !== 'false',
  UPDATE_METADATA_URL: process.env.UPDATE_METADATA_URL || '',
  UPDATE_REQUEST_TOKEN: process.env.UPDATE_REQUEST_TOKEN || '',
  UPDATE_REQUEST_TOKEN_HEADER: process.env.UPDATE_REQUEST_TOKEN_HEADER || 'Authorization',
  UPDATE_REQUEST_TOKEN_PREFIX: process.env.UPDATE_REQUEST_TOKEN_PREFIX || 'Bearer ',
  UPDATE_REQUEST_TIMEOUT: parseInt(process.env.UPDATE_REQUEST_TIMEOUT, 10) || 15000,
  UPDATE_AUTO_CHECK_ON_START: process.env.UPDATE_AUTO_CHECK_ON_START !== 'false',
  UPDATE_AUTO_CHECK_DELAY_MS: parseInt(process.env.UPDATE_AUTO_CHECK_DELAY_MS, 10) || 5000,
  UPDATE_DOWNLOAD_DIR_NAME: process.env.UPDATE_DOWNLOAD_DIR_NAME || 'updates',
};

module.exports = config;
