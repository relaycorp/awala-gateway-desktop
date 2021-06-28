import { fork as forkChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { Duplex } from 'stream';

import { SubprocessError } from './SubprocessError';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
// istanbul ignore next
const SUBPROCESS_SCRIPT_NAME = IS_TYPESCRIPT ? 'subprocess.ts' : 'subprocess.js';
const ROOT_DIR = dirname(dirname(__dirname));
const SUBPROCESS_SCRIPT_PATH = join(ROOT_DIR, 'bin', SUBPROCESS_SCRIPT_NAME);

export function fork(subprocessName: string): Duplex {
  const childProcess = forkChildProcess(SUBPROCESS_SCRIPT_PATH, [subprocessName], {
    env: { ...process.env, LOG_FILES: 'true' },
  });
  const duplex = new Duplex({
    objectMode: true,
    read(): void {
      // Messages will be pushed as and when they're received
    },
    write(chunk, _encoding, cb): void {
      childProcess.send(chunk);
      cb();
    },
    destroy(error, cb): void {
      childProcess.kill();
      cb(error);
    },
  });

  childProcess.once('error', (err) => {
    duplex.destroy(err);
  });

  childProcess.once('exit', (code) => {
    const error =
      code && 0 < code
        ? new SubprocessError(`Subprocess "${subprocessName}" errored out with code ${code}`, code)
        : undefined;
    duplex.destroy(error);
  });

  childProcess.on('message', (message) => {
    duplex.push(message);
  });

  // TODO: When we support Node.js >= 16, return the duplex once the 'spawn' event has been emitted
  return duplex;
}
