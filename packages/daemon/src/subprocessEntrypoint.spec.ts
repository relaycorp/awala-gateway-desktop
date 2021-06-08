import { PassThrough } from 'stream';

import runStartup from './startup';
import subprocessEntrypoint from './subprocessEntrypoint';
import runParcelCollection from './sync/publicGateway/parcelDelivery/subprocess';
import { getMockInstance, mockSpy } from './testUtils/jest';
import { mockLoggerToken, partialPinoLog } from './testUtils/logging';
import * as parentSubprocess from './utils/subprocess/parent';

jest.mock('./sync/publicGateway/parcelDelivery/subprocess');
jest.mock('./startup');

const STUB_SUBPROCESS_NAME = 'parcel-delivery';

const stubParentStream = new PassThrough();

mockSpy(jest.spyOn(parentSubprocess, 'makeParentStream'), () => stubParentStream);

const mockProcessExit = mockSpy(jest.spyOn(process, 'exit'), () => undefined);

const mockLogSet = mockLoggerToken();

test('Startup routine should be called', async () => {
  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(runStartup).toBeCalledWith(STUB_SUBPROCESS_NAME);
});

test('Parent stream should be passed to subprocess', async () => {
  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(runParcelCollection).toBeCalledWith(stubParentStream);
  expect(runParcelCollection).toHaveBeenCalledAfter(runStartup as any);
});

test('Subprocess return code should be used as exit code', async () => {
  const exitCode = 42;
  getMockInstance(runParcelCollection).mockResolvedValue(exitCode);

  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(mockProcessExit).toBeCalledWith(exitCode);
});

test('Subprocess exceptions should be handled and exit with 128 code', async () => {
  const error = new Error('oh noes');
  getMockInstance(runParcelCollection).mockRejectedValue(error);

  await subprocessEntrypoint(STUB_SUBPROCESS_NAME);

  expect(mockProcessExit).toBeCalledWith(128);
  expect(mockLogSet).toContainEqual(
    partialPinoLog('fatal', 'Unhandled exception in subprocess', {
      err: expect.objectContaining({ message: error.message }),
    }),
  );
});

test('Unknown subprocess name should result in 129 exit code', async () => {
  const subprocessName = 'non-existing';

  await subprocessEntrypoint(subprocessName);

  expect(mockProcessExit).toBeCalledWith(129);
  expect(runStartup).not.toBeCalled();
});
