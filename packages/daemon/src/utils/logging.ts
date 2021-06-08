import { get as getEnvVar } from 'env-var';
import { join } from 'path';
import pino, { Level, Logger } from 'pino';

export function makeLogger(logName: string, logDir: string): Logger {
  const logToFiles = getEnvVar('LOG_FILES').default('false').asBool();
  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  const options = {
    level: logLevel,
    prettyPrint: {
      colorize: !logToFiles,
      ignore: 'hostname',
      translateTime: true,
    },
  };
  if (logToFiles) {
    // Write to files instead of stdout
    const logFilePath = join(logDir, `${logName}.log`);
    const destinationFile = pino.destination(logFilePath);
    return pino(options, destinationFile);
  }
  return pino(options);
}
