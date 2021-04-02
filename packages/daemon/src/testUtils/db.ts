import { Connection, ConnectionOptions, createConnection, getConnectionOptions } from 'typeorm';

export function setUpTestDBConnection(): void {
  let connectionOptions: ConnectionOptions;
  beforeAll(async () => {
    connectionOptions = await getConnectionOptions();
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
