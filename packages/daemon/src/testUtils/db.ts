import { ENTITIES } from '@relaycorp/keystore-db';
import { dirname, join } from 'path';
import { Connection, createConnection, getConnectionOptions } from 'typeorm';

const IS_TYPESCRIPT = __filename.endsWith('.ts');

export function setUpTestDBConnection(): void {
  beforeAll(async () => {
    const originalConnectionOptions = await getConnectionOptions();

    const entityDirPath = join(dirname(__dirname), 'entity', '**', IS_TYPESCRIPT ? '*.ts' : '*.js');
    const connectionOptions = {
      ...originalConnectionOptions,
      database: ':memory:',
      dropSchema: true,
      entities: [entityDirPath, ...ENTITIES],
    };
    connection = await createConnection(connectionOptions as any);
  });

  let connection: Connection;

  beforeEach(async () => {
    await connection.synchronize(true);
  });

  afterEach(async () => {
    await connection.dropDatabase();
  });

  afterAll(async () => {
    await connection.close();
  });
}
