require('dotenv').config();

const config = {
  // Service port
  PORT: parseInt(process.env.PORT, 10) || 8765,
};

module.exports = config;
