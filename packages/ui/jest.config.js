const mainJestConfig = require('../../jest.config');

module.exports = {
  ...mainJestConfig,
  coverageThreshold: {
    "global": {
      "branches": 60,
      "functions": 60,
      "lines": 60,
      "statements": 60
    }
  },
  testEnvironment: "jsdom",
};
