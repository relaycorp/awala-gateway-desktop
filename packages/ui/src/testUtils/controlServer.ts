import fetchMock from 'fetch-mock-jest';

export interface ControlServerOutput {
  readonly internetGatewayAddress: string;
}

export function mockControlServer(): ControlServerOutput {
  const publicAddress = 'braavos.relaycorp.cloud';
  const request = {
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    url: 'http://127.0.0.1:13276/_control/public-gateway',
  };

  beforeAll(() => {
    fetchMock.reset();
    fetchMock.get(request, {
      body: { publicAddress },
      status: 200,
    });
  });

  return { internetGatewayAddress: publicAddress };
}
