import childProcess from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import pipe from 'it-pipe';
import { dirname, join } from 'path';
import { Duplex } from 'stream';
import { source } from 'stream-to-it';

import { asyncIterableToArray, iterableTake } from '../../testUtils/iterables';
import { getMockInstance } from '../../testUtils/jest';
import { getPromiseRejection } from '../../testUtils/promises';
import { setImmediateAsync } from '../../testUtils/timing';
import { fork } from './Subprocess';
import { SubprocessError } from './SubprocessError';

jest.mock('child_process');

let mockChildProcess: MockChildProcess;
beforeEach(() => {
  mockChildProcess = new MockChildProcess();
  getMockInstance(childProcess.fork).mockReturnValue(mockChildProcess);
});

describe('fork', () => {
  test('Subprocess script should be run', async () => {
    await testSuccessfulFork('foo');

    const isTypescript = __filename.endsWith('.ts');
    const expectedScriptPath = join(
      dirname(__dirname),
      'bin',
      isTypescript ? 'subprocess.ts' : 'subprocess.js',
    );
    await expect(fs.stat(expectedScriptPath)).toResolve();
    expect(childProcess.fork).toBeCalledWith(expectedScriptPath, expect.anything());
  });

  test('Subprocess name should be passed as argument', async () => {
    const subprocessName = 'foo';

    await testSuccessfulFork(subprocessName);

    expect(childProcess.fork).toBeCalledWith(expect.anything(), [subprocessName]);
  });

  test('Stream should be returned as soon as the process is spawn', async () => {
    const subprocess = await testSuccessfulFork('foo');

    expect(subprocess).toBeInstanceOf(Duplex);
  });

  test('Failure to spawn should be propagated', async () => {
    const spawnError = new Error('denied.png');
    setImmediate(() => {
      mockChildProcess.emit('error', spawnError);
    });

    const error = await getPromiseRejection(fork('foo'), SubprocessError);

    expect(error.message).toMatch(/^Failed to spawn subprocess:/);
    expect(error.cause()).toEqual(spawnError);
  });

  test('Stream should be destroyed with an error when one is emitted', async (cb) => {
    const originalError = new Error('denied.png');

    const subprocess = await testSuccessfulFork('foo');

    subprocess.on('error', (error) => {
      expect(error).toBe(originalError);
      cb();
    });
    mockChildProcess.emit('error', originalError);
  });

  test('Stream should be destroyed with an error when the subprocess errors out', async (cb) => {
    const exitCode = 12;

    const subprocess = await testSuccessfulFork('foo');

    subprocess.on('error', (error) => {
      expect(error).toBeInstanceOf(SubprocessError);
      expect(error.message).toEqual(`Subprocess errored out with code ${exitCode}`);
      cb();
    });
    mockChildProcess.emit('exit', exitCode, null);
  });

  test('Stream should be destroyed with an error when the subprocess is killed', async (cb) => {
    const signal = 'SIGTERM';

    const subprocess = await testSuccessfulFork('foo');

    subprocess.on('error', (error) => {
      expect(error).toBeInstanceOf(SubprocessError);
      expect(error.message).toEqual(`Subprocess was killed with ${signal}`);
      cb();
    });
    mockChildProcess.emit('exit', null, signal);
  });

  test('Stream should end when subprocess ends normally', async (cb) => {
    const subprocess = await testSuccessfulFork('foo');

    subprocess.on('error', cb);
    subprocess.on('close', cb);
    mockChildProcess.emit('exit', 0, null);
  });

  test('Messages sent to the writable stream should be passed to the subprocess', async () => {
    const messages: readonly string[] = ['one', 'dos', 'trois'];

    const subprocess = await testSuccessfulFork('foo');

    messages.forEach((message) => subprocess.write(message));
    await setImmediateAsync();
    expect(mockChildProcess.sentMessages).toEqual(messages);
  });

  test('Messages sent by the subprocess should be passed to the readable stream', async () => {
    const messages: readonly string[] = ['foo', 'bar', 'baz'];

    const subprocess = await testSuccessfulFork('foo');

    setImmediate(() => messages.forEach((message) => mockChildProcess.emit('message', message)));
    await expect(
      pipe(source(subprocess), iterableTake(messages.length), asyncIterableToArray),
    ).resolves.toEqual(messages);
  });
});

async function testSuccessfulFork(subprocessName: string): Promise<Duplex> {
  setImmediate(() => mockChildProcess.emit('spawn'));

  return fork(subprocessName);
}

/**
 * Mock version of `ChildProcess`.
 */
class MockChildProcess extends EventEmitter {
  // tslint:disable-next-line:readonly-array
  public readonly sentMessages: any[] = [];

  public send(message: any): void {
    this.sentMessages.push(message);
  }
}
