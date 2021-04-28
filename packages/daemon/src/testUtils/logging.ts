import pino from 'pino';
import split2 from 'split2';
import { Container } from 'typedi';

import { LOGGER } from '../tokens';
import { mockToken } from './tokens';

// tslint:disable-next-line:readonly-array
export type MockLogSet = object[];

export interface MockLogging {
  readonly logger: pino.Logger;
  readonly logs: MockLogSet;
}

/**
 * @deprecated Use makeMockLoggingFixture() instead
 */
export function makeMockLogging(): MockLogging {
  // tslint:disable-next-line:readonly-array
  const logs: object[] = [];
  const stream = split2((data) => {
    logs.push(JSON.parse(data));
  });
  const logger = pino({ level: 'debug' }, stream);
  return { logger, logs };
}

export function makeMockLoggingFixture(): MockLogging {
  const mockLogging = makeMockLogging();

  beforeEach(() => {
    mockLogging.logs.splice(0, mockLogging.logs.length);
  });

  return mockLogging;
}

export function mockLoggerToken(): MockLogSet {
  const mockLogging = makeMockLoggingFixture();

  mockToken(LOGGER);

  beforeEach(() => {
    Container.set(LOGGER, mockLogging.logger);
  });

  return mockLogging.logs;
}

export function partialPinoLog(level: pino.Level, message: string, extraAttributes?: any): object {
  const levelNumber = pino.levels.values[level];
  return expect.objectContaining({
    level: levelNumber,
    msg: message,
    ...(extraAttributes && extraAttributes),
  });
}
