import { get as getEnvVar } from 'env-var';
import { join } from 'path';
import pino, { Level, Logger } from 'pino';

export function makeLogger(logName: string, logDir: string): Logger {
  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  const options = { level: logLevel };
  if (process.send !== undefined) {
    // Process was forked, so we can't write to stdout/stderr
    const logFilePath = join(logDir, `${logName}.log`);
    const destinationFile = pino.destination(logFilePath);
    return pino(options, destinationFile);
  }
  return pino(options);
}
