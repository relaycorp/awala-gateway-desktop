import { fork as forkChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { Duplex } from 'stream';
import { SubprocessError } from './SubprocessError';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
// istanbul ignore next
const SUBPROCESS_SCRIPT_NAME = IS_TYPESCRIPT ? 'subprocess.ts' : 'subprocess.js';
const ROOT_DIR = dirname(dirname(__dirname));
const SUBPROCESS_SCRIPT_PATH = join(ROOT_DIR, 'bin', SUBPROCESS_SCRIPT_NAME);

export async function fork(subprocessName: string): Promise<Duplex> {
  const childProcess = forkChildProcess(SUBPROCESS_SCRIPT_PATH, [subprocessName], {
    env: { ...process.env, LOG_FILES: 'true' },
  });
  const duplex = new Duplex({
    objectMode: true,
    read(): void {
      childProcess.on('message', (message) => {
        this.push(message);
      });
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

  childProcess.once('exit', (code) => {
    const error =
      code && 0 < code
        ? new SubprocessError(`Subprocess "${subprocessName}" errored out with code ${code}`)
        : undefined;
    duplex.destroy(error);
  });

  return new Promise((resolve, reject) => {
    childProcess.once('spawn', () => {
      childProcess.once('error', (err) => {
        duplex.destroy(err);
      });
      resolve(duplex);
    });

    childProcess.once('error', (err) => {
      reject(new SubprocessError(err, 'Failed to spawn subprocess'));
    });
  });
}
