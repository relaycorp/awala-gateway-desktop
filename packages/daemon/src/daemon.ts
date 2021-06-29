import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { getConnection } from 'typeorm';

import { PendingParcelCollectionACK } from './entity/PendingParcelCollectionACK';
import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';

const TYPEORM_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';

export default async function (): Promise<void> {
  await startup('daemon');

  await purgeExpiredParcelCollectionACKs();

  const server = await makeServer();
  await Promise.all([runServer(server), runSync()]);
}

async function purgeExpiredParcelCollectionACKs(): Promise<void> {
  const cutoffDate = sqliteDateFormat(new Date());
  await getConnection()
    .createQueryBuilder()
    .delete()
    .from(PendingParcelCollectionACK)
    .where('parcelExpiryDate <= :date', {
      date: cutoffDate,
    })
    .execute();
}

function sqliteDateFormat(date: Date): string {
  const zonedDate = utcToZonedTime(date, 'UTC');
  return format(zonedDate, TYPEORM_DATE_FORMAT, {
    timeZone: 'UTC',
  } as any);
}
