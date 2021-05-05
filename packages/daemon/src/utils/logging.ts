import { get as getEnvVar } from 'env-var';
import { join } from 'path';
import pino, { Level, Logger } from 'pino';

export function makeLogger(logName: string, logDir: string): Logger {
  const wasForkedByUI = getEnvVar('GATEWAY_FORKED_FROM_UI').default('false').asBool();
  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  const options = {
    level: logLevel,
    prettyPrint: {
      colorize: !wasForkedByUI,
      ignore: 'hostname',
      translateTime: true,
    },
  };
  if (wasForkedByUI) {
    // We can't write to stdout
    const logFilePath = join(logDir, `${logName}.log`);
    const destinationFile = pino.destination(logFilePath);
    return pino(options, destinationFile);
  }
  return pino(options);
}
