import { useFakeTimers } from '../testUtils/jest';
import { sleepSeconds } from './timing';

useFakeTimers();

describe('sleepSeconds', () => {
  const TIMEOUT_SECONDS = 60;

  test('Promise should not resolve before specified seconds have elapsed', async () => {
    let promiseResolved = false;

    sleepSeconds(TIMEOUT_SECONDS).then(() => (promiseResolved = true));

    jest.advanceTimersByTime(TIMEOUT_SECONDS * 1_000 - 1);
    expect(promiseResolved).toBeFalse();
    jest.runAllTimers();
  });

  test('Promise should resolve once specified seconds have elapsed', async () => {
    const sleepSecondsPromise = sleepSeconds(TIMEOUT_SECONDS);

    jest.advanceTimersByTime(TIMEOUT_SECONDS * 1_000);
    await sleepSecondsPromise;
  });
});
