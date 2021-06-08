import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileStore, FileStoreError } from './fileStore';
import { asyncIterableToArray } from './testUtils/iterables';
import { getPromiseRejection } from './testUtils/promises';

let tempDir: string;
let tempAppDirs: Paths;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(tmpdir(), 'awala-gw-tests'));
  tempAppDirs = {
    cache: `${tempDir}/cache`,
    config: `${tempDir}/config`,
    data: `${tempDir}/data`,
    log: `${tempDir}/log`,
    temp: `${tempDir}/temp`,
  };
});
afterEach(async () => {
  await fs.rmdir(tempDir, { recursive: true });
});

const OBJECT_KEY = 'the-key.ext';
const OBJECT_CONTENT = Buffer.from('the content');

describe('getObject', () => {
  test('Content of existing file should be returned', async () => {
    const store = new FileStore(tempAppDirs);
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await expect(store.getObject(OBJECT_KEY)).resolves.toEqual(OBJECT_CONTENT);
  });

  test('Null should be returned if file does not exist', async () => {
    const store = new FileStore(tempAppDirs);

    await expect(store.getObject(OBJECT_KEY)).resolves.toBeNull();
  });

  test('Permission errors should be propagated', async () => {
    const store = new FileStore(tempAppDirs);
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);
    const readError = new Error('oh no');
    const readFileSpy = jest.spyOn(fs, 'readFile');
    readFileSpy.mockRejectedValueOnce(readError);

    const error = await getPromiseRejection(store.getObject(OBJECT_KEY), FileStoreError);

    expect(error.message).toMatch(/^Failed to read object/);
    expect(error.cause()).toEqual(readError);
  });
});

describe('putObject', () => {
  test('File should be created if it does not exist', async () => {
    const store = new FileStore(tempAppDirs);

    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await expect(fs.readFile(join(tempAppDirs.data, OBJECT_KEY))).resolves.toEqual(OBJECT_CONTENT);
  });

  test('Paths should be created if necessary', async () => {
    const store = new FileStore(tempAppDirs);
    const nestedObjectKey = join('prefix', OBJECT_KEY);

    await store.putObject(OBJECT_CONTENT, nestedObjectKey);

    await expect(fs.readFile(join(tempAppDirs.data, nestedObjectKey))).resolves.toEqual(
      OBJECT_CONTENT,
    );
  });

  test('File should be overridden if it already exists', async () => {
    const store = new FileStore(tempAppDirs);

    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);
    const contentV2 = Buffer.concat([OBJECT_CONTENT, Buffer.from(' extra')]);
    await store.putObject(contentV2, OBJECT_KEY);

    await expect(fs.readFile(join(tempAppDirs.data, OBJECT_KEY))).resolves.toEqual(contentV2);
  });
});

describe('deleteObject', () => {
  test('Non-existing object should be ignored', async () => {
    const store = new FileStore(tempAppDirs);

    await store.deleteObject(OBJECT_KEY);
  });

  test('Error deleting file should be propagated', async () => {
    const store = new FileStore(tempAppDirs);
    const unlinkError = new Error('oh no');
    const unlinkSpy = jest.spyOn(fs, 'unlink');
    unlinkSpy.mockRejectedValueOnce(unlinkError);

    const error = await getPromiseRejection(store.deleteObject(OBJECT_KEY), FileStoreError);

    expect(error.message).toMatch(/^Failed to delete object: /);
    expect(error.cause()).toEqual(unlinkError);
  });

  test('Existing object should be deleted', async () => {
    const store = new FileStore(tempAppDirs);
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await store.deleteObject(OBJECT_KEY);

    await expect(store.getObject(OBJECT_KEY)).resolves.toBeNull();
  });
});

describe('listObjects', () => {
  const keyPrefix = 'sub';

  test('Non-existing key prefixes should be ignored', async () => {
    const store = new FileStore(tempAppDirs);

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toHaveLength(0);
  });

  test('Error reading existing key prefix should be propagated', async () => {
    const store = new FileStore(tempAppDirs);
    const readError = new Error('oh no');
    const readdirSpy = jest.spyOn(fs, 'readdir');
    readdirSpy.mockRejectedValueOnce(readError);

    const error = await getPromiseRejection(
      asyncIterableToArray(store.listObjects(keyPrefix)),
      FileStoreError,
    );

    expect(error.message).toMatch(/^Failed to read directory: /);
    expect(error.cause()).toEqual(readError);
  });

  test('No objects should be output if there are none', async () => {
    const store = new FileStore(tempAppDirs);
    const subdirectoryPath = join(tempAppDirs.data, keyPrefix);
    await fs.mkdir(subdirectoryPath, { recursive: true });

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toHaveLength(0);
  });

  test('Objects at the root should be output', async () => {
    const store = new FileStore(tempAppDirs);
    const key = join(keyPrefix, 'thingy');
    await store.putObject(OBJECT_CONTENT, key);

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toEqual([key]);
  });

  test('Objects in subdirectories should be output', async () => {
    const store = new FileStore(tempAppDirs);
    const key = join(keyPrefix, 'another-sub', 'thingy');
    await store.putObject(OBJECT_CONTENT, key);

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toEqual([key]);
  });
});
