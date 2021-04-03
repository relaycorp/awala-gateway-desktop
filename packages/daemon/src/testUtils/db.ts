import { Connection, ConnectionOptions, createConnection, getConnectionOptions } from 'typeorm';

const isTypescript = __filename.endsWith('.ts');

export function setUpTestDBConnection(): void {
  let connectionOptions: ConnectionOptions;
  beforeAll(async () => {
    const originalConnectionOptions = await getConnectionOptions();
    connectionOptions = {
      ...originalConnectionOptions,
      entities: isTypescript ? originalConnectionOptions.entities : ['build/entity/**/*.js'],
    };
  });

  let connection: Connection;

  beforeEach(async () => {
    connection = await createConnection({
      ...(connectionOptions as any),
      database: ':memory:',
      dropSchema: true,
    });
  });

  afterEach(async () => {
    await connection.close();
  });
}
