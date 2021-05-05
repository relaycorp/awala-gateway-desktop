import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileStore, FileStoreError } from './fileStore';
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
    const readFileSpy = jest.spyOn(fs, 'readFile')
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
