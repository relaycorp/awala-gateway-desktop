import { Duplex, PassThrough } from 'stream';

import runStartup from './startup';
import subprocessEntrypoint from './subprocessEntrypoint';
import runCourierSync from './sync/courierSync/subprocess';
import runParcelCollection from './sync/publicGateway/parcelCollection/subprocess';
import runParcelDelivery from './sync/publicGateway/parcelDelivery/subprocess';
import { getMockInstance, mockSpy } from './testUtils/jest';
import { mockLoggerToken, partialPinoLog } from './testUtils/logging';
import { makeProcessOnceMock } from './testUtils/process';
import * as parentSubprocess from './utils/subprocess/parent';

jest.mock('./sync/courierSync/subprocess');
jest.mock('./sync/publicGateway/parcelCollection/subprocess');
jest.mock('./sync/publicGateway/parcelDelivery/subprocess');
jest.mock('./startup');

const stubParentStream = new PassThrough();

mockSpy(jest.spyOn(parentSubprocess, 'makeParentStream'), () => stubParentStream);

const getProcessOnceHandler = makeProcessOnceMock();
const mockProcessExit = mockSpy(jest.spyOn(process, 'exit'), () => undefined);

const mockLogSet = mockLoggerToken();

const SUBPROCESSES: { readonly [key: string]: (s: Duplex) => Promise<number> } = {
  'courier-sync': runCourierSync,
  'parcel-collection': runParcelCollection,
  'parcel-delivery': runParcelDelivery,
};

// Pick a random subprocess for the tests
// const STUB_SUBPROCESS_NAME = 'parcel-delivery';
const [STUB_SUBPROCESS_NAME, STUB_PROCESS_CB] = Object.entries(SUBPROCESSES)[0];

test('Startup routine should be called', async () => {
  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(runStartup).toBeCalledWith(STUB_SUBPROCESS_NAME);
});

test('Parent stream should be passed to subprocess', async () => {
  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(STUB_PROCESS_CB).toBeCalledWith(stubParentStream);
  expect(STUB_PROCESS_CB).toHaveBeenCalledAfter(runStartup as any);
});

test('Subprocess return code should be used as exit code', async () => {
  const exitCode = 42;
  getMockInstance(STUB_PROCESS_CB).mockResolvedValue(exitCode);

  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(mockProcessExit).toBeCalledWith(exitCode);
});

test('Subprocess exceptions should be handled and exit with 128 code', async () => {
  const error = new Error('oh noes');
  getMockInstance(STUB_PROCESS_CB).mockRejectedValue(error);

  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(mockProcessExit).toBeCalledWith(128);
  expect(mockLogSet).toContainEqual(
    partialPinoLog('fatal', 'Unhandled exception in subprocess', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

test('Subprocess should exit when parent disconnects', async () => {
  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  const handler = getProcessOnceHandler('disconnect');
  handler();
  expect(mockProcessExit).toBeCalledWith();
  expect(mockLogSet).toContainEqual(partialPinoLog('fatal', 'Exiting due to parent disconnection'));
});

test.each(Object.entries(SUBPROCESSES))(
  'Subprocess %s should be registered',
  async (subprocessName, subprocessCallback) => {
    expect(subprocessCallback).not.toBeCalled();

    await subprocessEntrypoint(subprocessName);

    expect(subprocessCallback).toBeCalled();
  },
);

test('Unknown subprocess name should result in 129 exit code', async () => {
  const subprocessName = 'non-existing';

  await subprocessEntrypoint(subprocessName);

  expect(mockProcessExit).toBeCalledWith(129);
  expect(runStartup).not.toBeCalled();
});
