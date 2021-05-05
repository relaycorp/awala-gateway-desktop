import { Paths } from 'env-paths';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Container } from 'typedi';

import { APP_DIRS } from '../tokens';
import { mockToken } from './tokens';

export function useTemporaryAppDirs(): () => Paths {
  mockToken(APP_DIRS);

  let tempDir: string;
  let tempAppDirs: Paths;
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'app-dirs'));
    tempAppDirs = {
      cache: `${tempDir}/cache`,
      config: `${tempDir}/config`,
      data: `${tempDir}/data`,
      log: `${tempDir}/log`,
      temp: `${tempDir}/temp`,
    };
    Container.set(APP_DIRS, tempAppDirs);
  });

  afterEach(async () => {
    await fs.rmdir(tempDir, { recursive: true });
  });

  return () => tempAppDirs;
}
