const mainJestConfig = require('../../jest.config');

module.exports = {
  ...mainJestConfig,
  coverageThreshold: {
    "global": {
      "branches": 50,
      "functions": 50,
      "lines": 50,
      "statements": 50
    }
  },
};
