const mainJestConfig = require('../../jest.config');

module.exports = {
  ...mainJestConfig,
  setupFilesAfterEnv: [...mainJestConfig.setupFilesAfterEnv, './jest.setup.js'],
};
