const mainJestConfig = require('../../jest.config');

module.exports = {
  ...mainJestConfig,
  collectCoverageFrom: ["**/*.ts", "**/*.tsx"],
  coverageThreshold: {
    "global": {
      "branches": 60,
      "functions": 60,
      "lines": 60,
      "statements": 60
    }
  },
  setupFilesAfterEnv: [
    "@testing-library/jest-dom/extend-expect"
  ],
  testEnvironment: "jsdom",
};
