import { fork as forkChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { Duplex } from 'stream';
import { SubprocessError } from './SubprocessError';

const IS_TYPESCRIPT = __filename.endsWith('.ts');
const SUBPROCESS_SCRIPT_PATH = join(
  dirname(__dirname),
  'bin',
  IS_TYPESCRIPT ? 'subprocess.ts' : 'subprocess.js',
);

export async function fork(subprocessName: string): Promise<Duplex> {
  const childProcess = forkChildProcess(SUBPROCESS_SCRIPT_PATH, [subprocessName]);
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
  });

  childProcess.once('exit', (code, signal) => {
    let error: Error | undefined;
    if (code === 0) {
      error = undefined;
    } else {
      const errorMessage = code
        ? `Subprocess errored out with code ${code}`
        : `Subprocess was killed with ${signal}`;
      error = new SubprocessError(errorMessage);
    }
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
