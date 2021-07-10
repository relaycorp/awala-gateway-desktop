import { mockSpy } from './jest';

export function makeProcessSendMock(): (implementation?: (message: any) => boolean) => void {
  let originalProcessSend: any;

  beforeAll(() => {
    originalProcessSend = process.send;
  });

  beforeEach(() => {
    // tslint:disable-next-line:no-object-mutation
    process.send = undefined;
  });

  afterAll(async () => {
    // tslint:disable-next-line:no-object-mutation
    process.send = originalProcessSend;
  });

  return (implementation) => {
    // tslint:disable-next-line:no-object-mutation
    process.send = implementation;
  };
}

export function makeProcessOnceMock(): (eventName: string) => (...args: readonly any[]) => any {
  const mockProcessOnce = mockSpy(jest.spyOn(process, 'once'));

  return (eventName) => {
    expect(mockProcessOnce).toBeCalledWith(eventName, expect.any(Function));

    const onceCall = mockProcessOnce.mock.calls.find((c) => c[0] === eventName)!!;
    return onceCall[1];
  };
}
