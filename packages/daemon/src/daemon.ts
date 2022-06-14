import { format } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { getConnection } from 'typeorm';

import { ParcelCollection } from './entity/ParcelCollection';
import { makeServer, runServer } from './server';
import startup from './startup';
import runSync from './sync';
import { Container } from 'typedi';
import { PrivateGatewayManager } from './PrivateGatewayManager';

const TYPEORM_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';

export default async function (): Promise<void> {
  await startup('daemon');

  await purgeExpiredParcelCollections();

  const gatewayManager = Container.get(PrivateGatewayManager);
  await gatewayManager.createCurrentIfMissing();

  const server = await makeServer();
  await Promise.all([runServer(server), runSync()]);
}

async function purgeExpiredParcelCollections(): Promise<void> {
  const cutoffDate = sqliteDateFormat(new Date());
  await getConnection()
    .createQueryBuilder()
    .delete()
    .from(ParcelCollection)
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
