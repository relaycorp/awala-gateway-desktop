import { createMockWebSocketStream } from '@relaycorp/ws-mock';
import WebSocket from 'ws';

export function mockWebsocketStream(): void {
  const mock = jest
    .spyOn(WebSocket, 'createWebSocketStream')
    .mockImplementation(createMockWebSocketStream);

  afterAll(() => {
    mock.mockRestore();
  });
}
