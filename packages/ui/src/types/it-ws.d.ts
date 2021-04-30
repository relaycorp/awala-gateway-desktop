declare module 'it-ws' {
  import { Duplex } from 'stream';
  import WebSocket from 'ws';
  interface Options {
    readonly binary: boolean;
  }
  interface SocketStream {
    readonly source: AsyncIterable<any>;
    readonly socket: WebSocket;
  }

  export function connect(url: string, options?: Options): SocketStream;
}
