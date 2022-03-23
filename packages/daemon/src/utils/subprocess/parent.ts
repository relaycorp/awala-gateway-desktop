import { Duplex } from 'stream';

import { SubprocessError } from './errors';

export async function makeParentStream(): Promise<Duplex> {
  if (!process.send) {
    throw new SubprocessError('The current process was not forked');
  }
  return new Duplex({
    objectMode: true,
    read(): void {
      process.on('message', (message) => {
        this.push(message);
      });
    },
    write(chunk, _encoding, cb): void {
      process.send!(chunk);
      cb();
    },
  });
}
