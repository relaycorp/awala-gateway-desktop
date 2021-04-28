import * as timing from '../utils/timing';

export async function setImmediateAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function mockSleepSeconds(): jest.SpyInstance {
  const mock = jest.spyOn(timing, 'sleepSeconds');

  beforeEach(() => {
    mock.mockReset();
    mock.mockResolvedValue(undefined);
  });

  afterAll(() => {
    mock.mockRestore();
  });

  return mock;
}
