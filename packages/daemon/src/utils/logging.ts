import { get as getEnvVar } from 'env-var';
import pino, { Level, Logger } from 'pino';

export function makeLogger(): Logger {
  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  return pino({ level: logLevel });
}
