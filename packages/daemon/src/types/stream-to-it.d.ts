declare module 'stream-to-it' {
  import { Readable, Writable } from 'stream';

  export function source(source: Readable): IterableIterator<any>;

  export function sink(destination: Writable): any;
}
