import { PassThrough, Readable, Writable } from 'stream';

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

export function recordReadableStreamMessages<T = any>(
  readableStream: Readable,
): () => readonly T[] {
  // tslint:disable-next-line:readonly-array
  const parentMessages: T[] = [];
  const recorder = new Writable({
    objectMode: true,
    write(chunk, _encoding, callback): void {
      parentMessages.push(chunk);
      callback();
    },
  });
  readableStream.pipe(recorder);

  return () => {
    readableStream.unpipe(recorder);
    recorder.destroy();
    return parentMessages;
  };
}
