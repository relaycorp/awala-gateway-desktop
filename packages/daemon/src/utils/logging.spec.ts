import { promises as fs } from 'fs';
import { hostname, tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';

import { configureMockEnvVars } from '../testUtils/envVars';
import { makeLogger } from './logging';

const REQUIRED_ENV_VARS = {};
const mockEnvVars = configureMockEnvVars(REQUIRED_ENV_VARS);

const LOG_NAME = 'foo';

describe('makeLogger', () => {
  const pinoDestinationSpy = jest.spyOn(pino, 'destination');
  let logDirPath: string;
  beforeEach(async () => {
    logDirPath = await fs.mkdtemp(join(tmpdir(), 'logging-tests'));
  });
  afterEach(async () => {
    // Windows will refuse to delete the directory if we don't close the log file first
    const pinoDestination = pinoDestinationSpy.mock.results[0]?.value;
    pinoDestination?.destroy();

    await fs.rmdir(logDirPath, { recursive: true });
  });

  test('Log level should be info if LOG_LEVEL env var is absent', () => {
    mockEnvVars(REQUIRED_ENV_VARS);

    const logger = makeLogger(LOG_NAME, logDirPath);

    expect(logger).toHaveProperty('level', 'info');
  });

  test('Log level in LOG_LEVEL env var should be honoured if present', () => {
    const loglevel = 'debug';
    mockEnvVars({ ...REQUIRED_ENV_VARS, LOG_LEVEL: loglevel });

    const logger = makeLogger(LOG_NAME, logDirPath);

    expect(logger).toHaveProperty('level', loglevel);
  });

  test('Log level in LOG_LEVEL env var should be lower-cased if present', () => {
    const loglevel = 'DEBUG';
    mockEnvVars({ ...REQUIRED_ENV_VARS, LOG_LEVEL: loglevel });

    const logger = makeLogger(LOG_NAME, logDirPath);

    expect(logger).toHaveProperty('level', loglevel.toLowerCase());
  });

  test('Logs should be saved to a file if the daemon was forked by UI', async () => {
    const logMessage = 'This is the message';
    mockEnvVars({ ...REQUIRED_ENV_VARS, GATEWAY_FORKED_FROM_UI: 'true' });

    const logger = makeLogger(LOG_NAME, logDirPath);
    logger.info(logMessage);

    const logFile = await fs.readFile(join(logDirPath, `${LOG_NAME}.log`));
    expect(logFile.toString()).toContain(logMessage);
  });

  test('Logs should be output to stdout if the daemon was not forked by UI', async () => {
    const logMessage = 'This is the message';

    const logger = makeLogger(LOG_NAME, logDirPath);
    logger.info(logMessage);

    await expect(fs.readdir(logDirPath)).resolves.toEqual([]);
  });

  describe('Log pretty-printing', () => {
    const logMessage = 'This should not be in a JSON document';

    beforeEach(() => {
      mockEnvVars({ ...REQUIRED_ENV_VARS, GATEWAY_FORKED_FROM_UI: 'true' });
      const logger = makeLogger(LOG_NAME, logDirPath);
      logger.info(logMessage);
    });

    test('Logs should be formatted as plain text instead of JSON', async () => {
      const logFile = await fs.readFile(join(logDirPath, `${LOG_NAME}.log`));
      expect(logFile.toString()).not.toContain('{');
    });

    test('Timestamp should be human-friendly', async () => {
      const logFile = await fs.readFile(join(logDirPath, `${LOG_NAME}.log`));
      expect(logFile.toString()).toMatch(/\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    });

    test('Hostname should be suppressed', async () => {
      const logFile = await fs.readFile(join(logDirPath, `${LOG_NAME}.log`));
      expect(logFile.toString()).not.toContain(hostname());
    });
  });
});
