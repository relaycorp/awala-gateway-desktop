import { promises as fs } from 'fs';
import { join } from 'path';

import { FileStore, FileStoreError } from './fileStore';
import { useTemporaryAppDirs } from './testUtils/appDirs';
import { asyncIterableToArray } from './testUtils/iterables';
import { getPromiseRejection } from './testUtils/promises';

const getTempAppDirs = useTemporaryAppDirs();
let store: FileStore;
beforeEach(() => {
  store = new FileStore(getTempAppDirs());
});

const OBJECT_KEY = 'the-key.ext';
const OBJECT_CONTENT = Buffer.from('the content');

const OBJECT_KEY_OUTSIDE_STORE = '../outside.ext';

describe('objectExists', () => {
  test('True should be returned if object exists', async () => {
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await expect(store.objectExists(OBJECT_KEY)).resolves.toBeTrue();
  });

  test('False should be returned if object does not exist', async () => {
    await expect(store.objectExists(OBJECT_KEY)).resolves.toBeFalse();
  });

  test('Relative key outside app dir should be refused', async () => {
    await expect(store.objectExists(OBJECT_KEY_OUTSIDE_STORE)).rejects.toBeInstanceOf(
      FileStoreError,
    );
  });

  test('Permission errors should be propagated', async () => {
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);
    const statError = new Error('oh no');
    const statSpy = jest.spyOn(fs, 'stat');
    statSpy.mockRejectedValueOnce(statError);

    const error = await getPromiseRejection(store.objectExists(OBJECT_KEY), FileStoreError);

    expect(error.message).toMatch(/^Failed to check whether object exists:/);
    expect(error.cause()).toEqual(statError);
  });
});

describe('getObject', () => {
  test('Content of existing file should be returned', async () => {
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await expect(store.getObject(OBJECT_KEY)).resolves.toEqual(OBJECT_CONTENT);
  });

  test('Null should be returned if file does not exist', async () => {
    await expect(store.getObject(OBJECT_KEY)).resolves.toBeNull();
  });

  test('Relative key outside app dir should be refused', async () => {
    await expect(store.getObject(OBJECT_KEY_OUTSIDE_STORE)).rejects.toBeInstanceOf(FileStoreError);
  });

  test('Permission errors should be propagated', async () => {
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
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await expect(fs.readFile(join(getTempAppDirs().data, OBJECT_KEY))).resolves.toEqual(
      OBJECT_CONTENT,
    );
  });

  test('Paths should be created if necessary', async () => {
    const nestedObjectKey = join('prefix', OBJECT_KEY);

    await store.putObject(OBJECT_CONTENT, nestedObjectKey);

    await expect(fs.readFile(join(getTempAppDirs().data, nestedObjectKey))).resolves.toEqual(
      OBJECT_CONTENT,
    );
  });

  test('File should be overridden if it already exists', async () => {
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);
    const contentV2 = Buffer.concat([OBJECT_CONTENT, Buffer.from(' extra')]);
    await store.putObject(contentV2, OBJECT_KEY);

    await expect(fs.readFile(join(getTempAppDirs().data, OBJECT_KEY))).resolves.toEqual(contentV2);
  });

  test('File should be flushed with fdatasync', async () => {
    const mockFileHandle = {
      close: jest.fn(),
      datasync: jest.fn(),
      write: jest.fn(),
    };
    const fsOpenSpy = jest.spyOn(fs, 'open').mockResolvedValue(mockFileHandle as any);
    try {
      await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

      expect(fsOpenSpy).toBeCalledWith(join(getTempAppDirs().data, OBJECT_KEY), 'w');
      expect(mockFileHandle.write).toBeCalledWith(OBJECT_CONTENT);
      expect(mockFileHandle.datasync).toBeCalled();
      expect(mockFileHandle.close).toBeCalled();
      expect(mockFileHandle.write).toHaveBeenCalledBefore(mockFileHandle.datasync);
    } finally {
      fsOpenSpy.mockRestore();
    }
  });

  test('Relative key outside app dir should be refused', async () => {
    await expect(store.putObject(OBJECT_CONTENT, OBJECT_KEY_OUTSIDE_STORE)).rejects.toBeInstanceOf(
      FileStoreError,
    );
  });
});

describe('deleteObject', () => {
  test('Non-existing object should be ignored', async () => {
    await store.deleteObject(OBJECT_KEY);
  });

  test('Error deleting file should be propagated', async () => {
    const unlinkError = new Error('oh no');
    const unlinkSpy = jest.spyOn(fs, 'unlink');
    unlinkSpy.mockRejectedValueOnce(unlinkError);

    const error = await getPromiseRejection(store.deleteObject(OBJECT_KEY), FileStoreError);

    expect(error.message).toMatch(/^Failed to delete object: /);
    expect(error.cause()).toEqual(unlinkError);
  });

  test('Existing object should be deleted', async () => {
    await store.putObject(OBJECT_CONTENT, OBJECT_KEY);

    await store.deleteObject(OBJECT_KEY);

    await expect(store.getObject(OBJECT_KEY)).resolves.toBeNull();
  });

  test('Relative key outside app dir should be refused', async () => {
    await expect(store.deleteObject(OBJECT_KEY_OUTSIDE_STORE)).rejects.toBeInstanceOf(
      FileStoreError,
    );
  });
});

describe('listObjects', () => {
  const keyPrefix = 'sub';

  test('Non-existing key prefixes should be ignored', async () => {
    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toHaveLength(0);
  });

  test('Error reading existing key prefix should be propagated', async () => {
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
    const subdirectoryPath = join(getTempAppDirs().data, keyPrefix);
    await fs.mkdir(subdirectoryPath, { recursive: true });

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toHaveLength(0);
  });

  test('Objects at the root should be output', async () => {
    const key = join(keyPrefix, 'thingy');
    await store.putObject(OBJECT_CONTENT, key);

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toEqual([key]);
  });

  test('Objects in subdirectories should be output', async () => {
    const key = join(keyPrefix, 'another-sub', 'thingy');
    await store.putObject(OBJECT_CONTENT, key);

    await expect(asyncIterableToArray(store.listObjects(keyPrefix))).resolves.toEqual([key]);
  });

  test('Relative key outside app dir should be refused', async () => {
    await expect(asyncIterableToArray(store.listObjects('..'))).rejects.toBeInstanceOf(
      FileStoreError,
    );
  });
});
