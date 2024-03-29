// tslint:disable:max-classes-per-file
import { Paths } from 'env-paths';
import { Dirent, promises as fs } from 'fs';
import { dirname, join, resolve } from 'path';
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

  public async objectExists(key: string): Promise<boolean> {
    const objectPath = this.getObjectPath(key);
    try {
      await fs.stat(objectPath);
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File does not exist
        return false;
      }
      throw new FileStoreError(err, 'Failed to check whether object exists');
    }
  }

  public async getObject(key: string): Promise<Buffer | null> {
    const objectPath = this.getObjectPath(key);
    try {
      return await fs.readFile(objectPath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // File does not exist
        return null;
      }
      throw new FileStoreError(err, 'Failed to read object');
    }
  }

  public async putObject(objectContent: Buffer, key: string): Promise<void> {
    const objectPath = this.getObjectPath(key);
    const objectDirPath = dirname(objectPath);
    await fs.mkdir(objectDirPath, { recursive: true });

    const file = await fs.open(objectPath, 'w');
    await file.write(objectContent);
    await file.datasync(); // Important to call fdatasync to avoid data loss
    await file.close();
  }

  public async deleteObject(key: string): Promise<void> {
    const objectPath = this.getObjectPath(key);
    try {
      await fs.unlink(objectPath);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw new FileStoreError(err, 'Failed to delete object');
      }
    }
  }

  public async *listObjects(keyPrefix: string): AsyncIterable<string> {
    const directoryPath = this.getObjectPath(keyPrefix);
    let directoryContents: readonly Dirent[];
    try {
      directoryContents = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch (err: any) {
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

  protected getObjectPath(key: string): string {
    const path = resolve(join(this.dataPath, key));

    // For security reasons, make sure we're not asked to operate outside the data directory
    if (!path.startsWith(this.dataPath)) {
      throw new FileStoreError(`Object key "${key}" resolves outside data directory`);
    }

    return path;
  }
}
