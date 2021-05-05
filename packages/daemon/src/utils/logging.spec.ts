import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { configureMockEnvVars } from '../testUtils/envVars';
import { makeProcessSendMock } from '../testUtils/process';
import { makeLogger } from './logging';

const REQUIRED_ENV_VARS = {};
const mockEnvVars = configureMockEnvVars(REQUIRED_ENV_VARS);

const mockProcessSend = makeProcessSendMock();

const LOG_NAME = 'foo';

describe('makeLogger', () => {
  let logDirPath: string;
  beforeEach(async () => {
    logDirPath = await fs.mkdtemp(join(tmpdir(), 'logging-tests'));
  });
  afterEach(async () => {
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

  test('Logs should be saved to a file if the daemon was forked', async () => {
    const logMessage = 'This is the message';
    mockProcessSend(() => true);

    const logger = makeLogger(LOG_NAME, logDirPath);
    logger.info(logMessage);

    const logFile = await fs.readFile(join(logDirPath, `${LOG_NAME}.log`));
    expect(logFile.toString()).toContain(logMessage);
  });

  test('Logs should be output to stdout if the daemon was not forked', async () => {
    const logMessage = 'This is the message';

    const logger = makeLogger(LOG_NAME, logDirPath);
    logger.info(logMessage);

    await expect(fs.readdir(logDirPath)).resolves.toEqual([]);
  });

  test.todo('Logs should be formatted as plain text instead of JSON');
});
