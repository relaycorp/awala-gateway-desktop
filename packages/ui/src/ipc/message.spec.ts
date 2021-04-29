import { ServerMessage, ServerMessageType } from '../ipc/message';

describe('ServerMessage', () => {
  test('is defined', async () => {
    function handler(message: ServerMessage) {
      return message;
    }
    const message = handler({
      type: ServerMessageType.TOKEN_MESSAGE,
      value: 'authtoken',
    });
    expect(message.value).toEqual('authtoken');
  });
});
