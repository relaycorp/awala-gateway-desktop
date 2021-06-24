import childProcess from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import pipe from 'it-pipe';
import { dirname, join } from 'path';
import { Duplex } from 'stream';
import { source } from 'stream-to-it';

import { asyncIterableToArray, iterableTake } from '../../testUtils/iterables';
import { getMockInstance } from '../../testUtils/jest';
import { setImmediateAsync } from '../../testUtils/timing';
import { fork } from './child';
import { SubprocessError } from './SubprocessError';

jest.mock('child_process');

let mockChildProcess: MockChildProcess;
beforeEach(() => {
  mockChildProcess = new MockChildProcess();
  getMockInstance(childProcess.fork).mockReturnValue(mockChildProcess);
});

const SUBPROCESS_NAME = 'foo';

describe('fork', () => {
  test('Subprocess script should be run', async () => {
    fork(SUBPROCESS_NAME);

    const isTypescript = __filename.endsWith('.ts');
    const expectedScriptPath = join(
      dirname(dirname(__dirname)),
      'bin',
      isTypescript ? 'subprocess.ts' : 'subprocess.js',
    );
    await expect(fs.stat(expectedScriptPath)).toResolve();
    expect(childProcess.fork).toBeCalledWith(
      expectedScriptPath,
      expect.anything(),
      expect.anything(),
    );
  });

  test('Subprocess name should be passed as argument', () => {
    const subprocessName = SUBPROCESS_NAME;

    fork(subprocessName);

    expect(childProcess.fork).toBeCalledWith(
      expect.anything(),
      [subprocessName],
      expect.anything(),
    );
  });

  test('Subprocess should be run with LOG_FILES=true', () => {
    fork(SUBPROCESS_NAME);

    expect(childProcess.fork).toBeCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: { ...process.env, LOG_FILES: 'true' },
      }),
    );
  });

  test('Stream should be returned as soon as the process is spawn', () => {
    const subprocess = fork(SUBPROCESS_NAME);

    expect(subprocess).toBeInstanceOf(Duplex);
  });

  test('Stream should be destroyed with an error when one is emitted', (cb) => {
    const originalError = new Error('denied.png');

    const subprocess = fork(SUBPROCESS_NAME);

    subprocess.on('error', (error) => {
      expect(error).toBe(originalError);
      cb();
    });
    mockChildProcess.emit('error', originalError);
  });

  test('Stream should be destroyed with an error when the subprocess errors out', (cb) => {
    const exitCode = 12;

    const subprocess = fork(SUBPROCESS_NAME);

    subprocess.on('error', (error) => {
      expect(error).toBeInstanceOf(SubprocessError);
      expect(error.message).toEqual(
        `Subprocess "${SUBPROCESS_NAME}" errored out with code ${exitCode}`,
      );
      cb();
    });
    mockChildProcess.emit('exit', exitCode, null);
  });

  test('Stream should end normally when the subprocess is killed', (cb) => {
    const signal = 'SIGTERM';

    const subprocess = fork(SUBPROCESS_NAME);

    subprocess.on('error', cb);
    subprocess.on('close', cb);
    mockChildProcess.emit('exit', null, signal);
  });

  test('Stream should end normally when subprocess ends normally', (cb) => {
    const subprocess = fork(SUBPROCESS_NAME);

    subprocess.on('error', cb);
    subprocess.on('close', cb);
    mockChildProcess.emit('exit', 0, null);
  });

  test('Subprocess should be killed when stream is destroyed', async () => {
    const subprocess = fork(SUBPROCESS_NAME);

    subprocess.destroy();

    await setImmediateAsync();
    expect(mockChildProcess.wasKilled).toBeTrue();
    expect(mockChildProcess.killSignal).toBeUndefined();
  });

  test('Messages sent to the writable stream should be passed to the subprocess', async () => {
    const messages: readonly string[] = ['one', 'dos', 'trois'];

    const subprocess = fork(SUBPROCESS_NAME);

    messages.forEach((message) => subprocess.write(message));
    await setImmediateAsync();
    expect(mockChildProcess.sentMessages).toEqual(messages);
  });

  test('Messages sent by the subprocess should be passed to the readable stream', async () => {
    const messages: readonly string[] = [SUBPROCESS_NAME, 'bar', 'baz'];

    const subprocess = fork(SUBPROCESS_NAME);

    setImmediate(() => messages.forEach((message) => mockChildProcess.emit('message', message)));
    await expect(
      pipe(source(subprocess), iterableTake(messages.length), asyncIterableToArray),
    ).resolves.toEqual(messages);
  });
});

/**
 * Mock version of `ChildProcess`.
 */
class MockChildProcess extends EventEmitter {
  // tslint:disable-next-line:readonly-array
  public readonly sentMessages: any[] = [];

  // tslint:disable-next-line:readonly-keyword
  public wasKilled: boolean = false;
  // tslint:disable-next-line:readonly-keyword
  public killSignal: string | undefined = undefined;

  public send(message: any): void {
    this.sentMessages.push(message);
  }

  public kill(signal?: string): void {
    // tslint:disable-next-line:no-object-mutation
    this.wasKilled = true;
    // tslint:disable-next-line:no-object-mutation
    this.killSignal = signal;
  }
}
