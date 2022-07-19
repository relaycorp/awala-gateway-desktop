import { Duplex } from 'stream';
import { Container } from 'typedi';

import runStartup from './startup';
import runCourierSync from './sync/courierSync/subprocess';
import runParcelCollection from './sync/publicGateway/parcelCollection/subprocess';
import runParcelDelivery from './sync/publicGateway/parcelDelivery/subprocess';
import { LOGGER } from './tokens';
import { makeParentStream } from './utils/subprocess/parent';

const SUBPROCESSES: { readonly [key: string]: (s: Duplex) => Promise<number> } = {
  'courier-sync': runCourierSync,
  'parcel-collection': runParcelCollection,
  'parcel-delivery': runParcelDelivery,
};

export default async function subprocessEntrypoint(subprocessName: string): Promise<void> {
  const subprocessCallback = SUBPROCESSES[subprocessName];

  let exitCode: number;

  if (subprocessCallback) {
    await runStartup(subprocessName);

    const logger = Container.get(LOGGER);

    process.once('disconnect', () => {
      logger.fatal('Exiting due to parent disconnection');
      process.exit();
    });

    try {
      exitCode = await subprocessCallback(await makeParentStream());
    } catch (err) {
      logger.fatal({ err }, 'Unhandled exception in subprocess');
      exitCode = 128;
    }
  } else {
    exitCode = 129;
  }

  process.exit(exitCode);
}
