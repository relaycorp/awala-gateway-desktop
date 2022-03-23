import { ChildProcess, fork as forkChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { Duplex } from 'stream';

import { SubprocessError, SubprocessExitError } from './errors';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
// istanbul ignore next
const SUBPROCESS_SCRIPT_NAME = IS_TYPESCRIPT ? 'subprocess.ts' : 'subprocess.js';
const ROOT_DIR = dirname(dirname(__dirname));
const SUBPROCESS_SCRIPT_PATH = join(ROOT_DIR, 'bin', SUBPROCESS_SCRIPT_NAME);

export async function fork(subprocessName: string): Promise<Duplex> {
  const childProcess = forkChildProcess(SUBPROCESS_SCRIPT_PATH, [subprocessName], {
    env: { ...process.env, LOG_FILES: 'true' },
  });

  return new Promise((resolve, reject) => {
    const spawnErrorHandler = (err: Error) => {
      reject(new SubprocessError(err, `Failed to spawn subprocess ${subprocessName}`));
    };
    childProcess.once('error', spawnErrorHandler);

    childProcess.once('spawn', () => {
      resolve(makeSubprocessStream(childProcess, subprocessName));
      childProcess.removeListener('error', spawnErrorHandler);
    });
  });
}

function makeSubprocessStream(childProcess: ChildProcess, subprocessName: string): Duplex {
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
    duplex.destroy(new SubprocessError(err, `Subprocess ${subprocessName} errored out`));
  });

  childProcess.once('exit', (code) => {
    const error =
      code && 0 < code
        ? new SubprocessExitError(
            `Subprocess "${subprocessName}" errored out with code ${code}`,
            code,
          )
        : undefined;
    duplex.destroy(error);
  });

  childProcess.on('message', (message) => {
    duplex.push(message);
  });

  return duplex;
}
