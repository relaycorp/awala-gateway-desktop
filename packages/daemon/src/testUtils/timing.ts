import * as timing from '../utils/timing';
import { mockSpy } from './jest';

export async function setImmediateAsync(): Promise<void> {
  const isUsingJestFakeTimers = Object.getOwnPropertyNames(setImmediate).includes('clock');
  if (!isUsingJestFakeTimers) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export function mockSleepSeconds(): jest.SpyInstance {
  return mockSpy(jest.spyOn(timing, 'sleepSeconds'), () => undefined);
}

export function mockSleepUntilDate(): jest.SpyInstance {
  return mockSpy(jest.spyOn(timing, 'sleepUntilDate'), () => undefined);
}
