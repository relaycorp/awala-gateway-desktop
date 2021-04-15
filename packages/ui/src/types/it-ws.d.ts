declare module 'it-ws' {
  import { Duplex } from 'stream';
  interface Options {
    readonly binary: boolean;
  }
  interface SocketStream {
    readonly source: AsyncIterable<any>;
  }

  export function connect(url: string, options?: Options): SocketStream;
}
