import { createMockWebSocketStream, MockClient } from '@relaycorp/ws-mock';
import WebSocket, { Server as WSServer } from 'ws';

export function mockWebsocketStream(): void {
  const mock = jest
    .spyOn(WebSocket, 'createWebSocketStream')
    .mockImplementation(createMockWebSocketStream);

  afterAll(() => {
    mock.mockRestore();
  });
}

export class MockAuthClient extends MockClient {
  constructor(wsServer: WSServer, authToken: string, headers?: { readonly [key: string]: string }) {
    super(wsServer, headers, `/?auth=${authToken}`);
  }
}
