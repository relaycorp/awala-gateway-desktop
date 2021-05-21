import pipe from 'it-pipe';
import { source } from 'stream-to-it';

import { asyncIterableToArray, iterableTake } from '../testUtils/iterables';
import { makeProcessSendMock } from '../testUtils/process';
import { getPromiseRejection } from '../testUtils/promises';
import { setImmediateAsync } from '../testUtils/timing';
import { makeParentStream } from './parent';
import { SubprocessError } from './SubprocessError';

const mockProcessSend = makeProcessSendMock();

afterEach(() => {
  process.removeAllListeners('message');
});

const MESSAGES: readonly string[] = ['trois', 'two', 'uno'];

describe('makeParentStream', () => {
  test('Error out if there is no parent process', async () => {
    const error = await getPromiseRejection(makeParentStream(), SubprocessError);

    expect(error.message).toEqual('The current process was not forked');
  });

  test('Messages from the parent should be read', async () => {
    mockProcessSend(() => true);

    const parentStream = await makeParentStream();

    setImmediate(() =>
      MESSAGES.forEach((message) => process.emit('message' as any, message as any)),
    );
    await expect(
      pipe(source(parentStream), iterableTake(MESSAGES.length), asyncIterableToArray),
    ).resolves.toEqual(MESSAGES);
  });

  test('Messages to the parent should be written', async () => {
    // tslint:disable-next-line:readonly-array
    const parentIncomingMessages: string[] = [];
    mockProcessSend((message) => {
      parentIncomingMessages.push(message);
      return true;
    });

    const parentStream = await makeParentStream();

    MESSAGES.forEach((message) => parentStream.write(message));
    await setImmediateAsync();
    expect(parentIncomingMessages).toEqual(MESSAGES);
  });
});
