declare module 'stream-to-it' {
  import { Duplex, Readable, Writable } from 'stream';

  export function source(source: Readable): IterableIterator<any>;

  export function sink(destination: Writable): (source: any) => Promise<void>;

  export function duplex(stream: Duplex): {
    readonly sink: IterableIterator<any>;
    readonly source: IterableIterator<any>;
  };
}
