import { PassThrough } from 'stream';

export function makeStubPassThrough(): () => PassThrough {
  let stream: PassThrough;

  beforeEach(() => {
    stream = new PassThrough({ objectMode: true });
  });

  afterEach(async () => {
    stream.destroy();
  });

  return () => stream;
}
