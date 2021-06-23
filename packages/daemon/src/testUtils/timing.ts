import * as timing from '../utils/timing';
import { mockSpy } from './jest';

export async function setImmediateAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function mockSleepSeconds(): jest.SpyInstance {
  return mockSpy(jest.spyOn(timing, 'sleepSeconds'), () => undefined);
}
