import { addMilliseconds, addSeconds, subMilliseconds } from 'date-fns';

import { useFakeTimers } from '../testUtils/jest';
import { sleepSeconds } from './timing';

useFakeTimers();

describe('sleepSeconds', () => {
  test('Should wait for the specified number of seconds', async () => {
    const startDate = new Date();

    await Promise.race([
      sleepSeconds(2),
      new Promise((resolve) => {
        jest.advanceTimersByTime(2_000);
        resolve(undefined);
      }),
    ]);

    const endDate = new Date();

    const expectedEndDate = addSeconds(startDate, 2);
    expect(endDate).toBeBefore(addMilliseconds(expectedEndDate, 100));
    expect(endDate).toBeAfter(subMilliseconds(expectedEndDate, 100));
  });
});
