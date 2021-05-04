import { mkdirSync } from 'fs';
import path from 'path';

import envPaths from 'env-paths';
import { get as getEnvVar } from 'env-var';
import pino, { Level, Logger } from 'pino';

export function makeLogger(): Logger {
  const paths = envPaths('AwalaGateway', { suffix: '' });
  mkdirSync(paths.log, { recursive: true });

  const logLevel = getEnvVar('LOG_LEVEL').default('info').asString().toLowerCase() as Level;
  return pino(
    {
      level: logLevel,
      prettyPrint: {
        colorize: false,
        translateTime: 'yyyy-dd-mm, h:MM:ss TT',
      },
    },
    pino.destination(path.join(paths.log, 'awala-daemon.log')),
  );
}
