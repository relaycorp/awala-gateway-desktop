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
  }
}
