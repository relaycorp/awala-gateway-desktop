const mainJestConfig = require('./jest.config');
const ciJestConfig = require('../../jest.config.ci.json');

module.exports = {
  ...mainJestConfig,
  ...ciJestConfig,
};
