import {
  addMinutes,
  addSeconds,
  differenceInMilliseconds,
  minutesToMilliseconds,
  subMilliseconds,
} from 'date-fns';

import { useFakeTimers } from '../testUtils/jest';
import { sleepSeconds, sleepUntilDate } from './timing';

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

describe('sleepUntilDate', () => {
  test('Promise should return immediately if date is in the past', async () => {
    jest.useRealTimers();
    const startDate = new Date();
    const timeoutDate = subMilliseconds(startDate, 1);

    await sleepUntilDate(timeoutDate);

    expect(new Date()).toBeBefore(addSeconds(startDate, 3));
  });

  test('Promise should return immediately if date is current', async () => {
    jest.useRealTimers();
    const timeoutDate = new Date();

    await sleepUntilDate(timeoutDate);

    expect(new Date()).toBeBefore(addSeconds(timeoutDate, 3));
  });

  test('Promise should not resolve when date is still in the future', async () => {
    const timeoutDate = addMinutes(new Date(), 15);
    let promiseResolved = false;

    sleepUntilDate(timeoutDate).then(() => (promiseResolved = true));

    jest.advanceTimersByTime(differenceInMilliseconds(timeoutDate, new Date()) - 1);

    expect(promiseResolved).toBeFalse();
  });

  test('Promise should resolve when date is reached', async () => {
    const timeoutDate = addMinutes(new Date(), 9);

    const sleepPromise = sleepUntilDate(timeoutDate);

    jest.advanceTimersByTime(minutesToMilliseconds(10));
    await sleepPromise;
  });

  test('Promise should resolve if specified abort signal is fired', async () => {
    const timeoutDate = addMinutes(new Date(), 15);
    const abortController = new AbortController();
    const sleepPromise = sleepUntilDate(timeoutDate, abortController.signal);

    abortController.abort();

    await sleepPromise;
  });
});
