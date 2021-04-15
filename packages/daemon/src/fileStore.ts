// tslint:disable:max-classes-per-file
import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
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
}
