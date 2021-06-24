import { sleepSeconds } from './timing';

jest.useFakeTimers("legacy");

describe('sleepSeconds', () => {
  test('Should wait for the specified number of seconds', async () => {
    setImmediate(() => jest.runAllTimers());
    await sleepSeconds(2);

    expect(setTimeout).toBeCalledWith(expect.any(Function), 2_000);
  });
});
