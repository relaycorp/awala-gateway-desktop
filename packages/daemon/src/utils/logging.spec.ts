import { configureMockEnvVars } from '../testUtils/envVars';
import { makeLogger } from './logging';

const REQUIRED_ENV_VARS = {};
const mockEnvVars = configureMockEnvVars(REQUIRED_ENV_VARS);

describe('makeLogger', () => {
  test('Log level should be info if LOG_LEVEL env var is absent', () => {
    mockEnvVars(REQUIRED_ENV_VARS);

    const logger = makeLogger();

    expect(logger).toHaveProperty('level', 'info');
  });

  test('Log level in LOG_LEVEL env var should be honoured if present', () => {
    const loglevel = 'debug';
    mockEnvVars({ ...REQUIRED_ENV_VARS, LOG_LEVEL: loglevel });

    const logger = makeLogger();

    expect(logger).toHaveProperty('level', loglevel);
  });

  test('Log level in LOG_LEVEL env var should be lower-cased if present', () => {
    const loglevel = 'DEBUG';
    mockEnvVars({ ...REQUIRED_ENV_VARS, LOG_LEVEL: loglevel });

    const logger = makeLogger();

    expect(logger).toHaveProperty('level', loglevel.toLowerCase());
  });
});
