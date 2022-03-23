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
import { getPromiseRejection } from '../../testUtils/promises';

jest.mock('child_process');

let mockChildProcess: MockChildProcess;
beforeEach(() => {
  mockChildProcess = new MockChildProcess();
  getMockInstance(childProcess.fork).mockReturnValue(mockChildProcess);
});

const SUBPROCESS_NAME = 'foo';

describe('fork', () => {
  test('Error should be thrown if child process fails to spawn', async () => {
    const originalError = new Error('Oh noes! Could not spawn');
    setImmediate(() => {
      mockChildProcess.emit('error', originalError);
    });

    const error = await getPromiseRejection(fork(SUBPROCESS_NAME), Error);

    expect(error).toBe(originalError);
  });

  test('Promise should not resolve until child process has been spawn', async () => {
    let promiseResolved = false;
    const subprocessPromise = fork(SUBPROCESS_NAME).then((subprocess) => {
      promiseResolved = true;
      return subprocess;
    });

    await setImmediateAsync();

    expect(promiseResolved).toBeFalse();

    mockChildProcess.queueSpawnEvent();
    await expect(subprocessPromise).toResolve();
    expect(mockChildProcess.listeners('error')).toHaveLength(1);
  });

  test('Subprocess script should be run', async () => {
    mockChildProcess.queueSpawnEvent();

    await fork(SUBPROCESS_NAME);

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

  test('Subprocess name should be passed as argument', async () => {
    const subprocessName = SUBPROCESS_NAME;
    mockChildProcess.queueSpawnEvent();

    await fork(subprocessName);

    expect(childProcess.fork).toBeCalledWith(
      expect.anything(),
      [subprocessName],
      expect.anything(),
    );
  });

  test('Subprocess should be run with LOG_FILES=true', async () => {
    mockChildProcess.queueSpawnEvent();

    await fork(SUBPROCESS_NAME);

    expect(childProcess.fork).toBeCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        env: { ...process.env, LOG_FILES: 'true' },
      }),
    );
  });

  test('Stream should be returned as soon as the process is spawn', async () => {
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

    expect(subprocess).toBeInstanceOf(Duplex);
  });

  test('Stream should be destroyed with an error when one is emitted', async () => {
    const originalError = new Error('denied.png');
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

    await expect(mockChildError(subprocess, originalError)).resolves.toBe(originalError);
  });

  test('Stream should be destroyed with an error when the subprocess errors out', async () => {
    const exitCode = 12;
    mockChildProcess.queueSpawnEvent();
    const subprocess = await fork(SUBPROCESS_NAME);

    const error = await getPromiseRejection(
      mockChildExit(subprocess, exitCode, null),
      SubprocessError,
    );

    expect(error.message).toEqual(
      `Subprocess "${SUBPROCESS_NAME}" errored out with code ${exitCode}`,
    );
    expect(error.exitCode).toEqual(exitCode);
  });

  test('Stream should end normally when the subprocess is killed', async () => {
    const signal = 'SIGTERM';
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

    await mockChildExit(subprocess, null, signal);
  });

  test('Stream should end normally when subprocess ends normally', async () => {
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

    await mockChildExit(subprocess, 0, null);
  });

  test('Subprocess should be killed when stream is destroyed', async () => {
    mockChildProcess.queueSpawnEvent();
    const subprocess = await fork(SUBPROCESS_NAME);

    subprocess.destroy();

    await setImmediateAsync();
    expect(mockChildProcess.wasKilled).toBeTrue();
    expect(mockChildProcess.killSignal).toBeUndefined();
  });

  test('Messages sent to the writable stream should be passed to the subprocess', async () => {
    const messages: readonly string[] = ['one', 'dos', 'trois'];
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

    messages.forEach((message) => subprocess.write(message));
    await setImmediateAsync();
    expect(mockChildProcess.sentMessages).toEqual(messages);
  });

  test('Messages sent by the subprocess should be passed to the readable stream', async () => {
    const messages: readonly string[] = [SUBPROCESS_NAME, 'bar', 'baz'];
    mockChildProcess.queueSpawnEvent();

    const subprocess = await fork(SUBPROCESS_NAME);

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

  public queueSpawnEvent(): void {
    setImmediate(() => {
      this.emit('spawn');
    });
  }
}

function mockChildError<E extends Error>(subprocess: Duplex, childError?: E): Promise<E> {
  return new Promise<E>((resolve) => {
    subprocess.on('error', resolve);
    mockChildProcess.emit('error', childError);
  });
}

function mockChildExit(
  subprocess: Duplex,
  exitCode: number | null,
  signal: string | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    subprocess.on('error', reject);
    subprocess.on('close', resolve);
    mockChildProcess.emit('exit', exitCode, signal);
  });
}
