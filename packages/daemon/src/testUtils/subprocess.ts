import { Duplex } from 'stream';

import * as child from '../utils/subprocess/child';
import { mockSpy } from './jest';
import { makeStubPassThrough } from './stream';

export function mockFork(): () => Duplex {
  const getSubprocessStream = makeStubPassThrough();
  mockSpy(jest.spyOn(child, 'fork'), getSubprocessStream);
  return getSubprocessStream;
}
