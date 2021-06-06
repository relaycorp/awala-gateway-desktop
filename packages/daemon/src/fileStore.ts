// tslint:disable:max-classes-per-file
import { Paths } from 'env-paths';
import { Dirent, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { Inject, Service } from 'typedi';

import { PrivateGatewayError } from './errors';
import { APP_DIRS } from './tokens';

export class FileStoreError extends PrivateGatewayError {}

@Service()
export class FileStore {
  protected readonly dataPath: string;

  constructor(@Inject(APP_DIRS) appDirs: Paths) {
    this.dataPath = appDirs.data;
  }

  public async getObject(key: string): Promise<Buffer | null> {
    const objectPath = join(this.dataPath, key);
    try {
      return await fs.readFile(objectPath);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // File does not exist
        return null;
      }
      throw new FileStoreError(err, 'Failed to read object');
    }
  }

  public async putObject(objectContent: Buffer, key: string): Promise<void> {
    const objectPath = join(this.dataPath, key);
    const objectDirPath = dirname(objectPath);
    await fs.mkdir(objectDirPath, { recursive: true });
    await fs.writeFile(objectPath, objectContent);
  }

  public async *listObjects(keyPrefix: string): AsyncIterable<string> {
    const directoryPath = join(this.dataPath, keyPrefix);
    let directoryContents: readonly Dirent[];
    try {
      directoryContents = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') {
        directoryContents = [];
      } else {
        throw new FileStoreError(err, 'Failed to read directory');
      }
    }
    for (const directoryItem of directoryContents) {
      const itemRelativePath = join(keyPrefix, directoryItem.name);
      if (directoryItem.isDirectory()) {
        yield* await this.listObjects(itemRelativePath);
      } else {
        yield itemRelativePath;
      }
    }
  }
}
