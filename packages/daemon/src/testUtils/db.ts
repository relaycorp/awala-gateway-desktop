import { Connection, createConnection, getConnectionOptions } from 'typeorm';

const isTypescript = __filename.endsWith('.ts');

export function setUpTestDBConnection(): void {
  beforeAll(async () => {
    const originalConnectionOptions = await getConnectionOptions();
    const connectionOptions = {
      ...originalConnectionOptions,
      entities: isTypescript ? originalConnectionOptions.entities : ['build/entity/**/*.js'],
    };
    connection = await createConnection({
      ...(connectionOptions as any),
      database: ':memory:',
      dropSchema: true,
    });
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
