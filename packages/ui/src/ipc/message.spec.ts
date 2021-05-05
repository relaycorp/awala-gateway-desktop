import { ServerMessage, ServerMessageType } from '../ipc/message';

describe('ServerMessage', () => {
  test('is defined', async () => {
    function handler(message: ServerMessage): ServerMessage {
      return message;
    }
    const serverMessage = handler({
      type: ServerMessageType.TOKEN_MESSAGE,
      value: 'authtoken',
    });
    expect(serverMessage.value).toEqual('authtoken');
  });
});
