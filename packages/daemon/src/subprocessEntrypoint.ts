import { Duplex } from 'stream';
import { Container } from 'typedi';

import runStartup from './startup';
import runParcelDelivery from './sync/publicGateway/parcelDelivery/subprocess';
import { LOGGER } from './tokens';
import { makeParentStream } from './utils/subprocess/parent';

const SUBPROCESSES: { readonly [key: string]: (s: Duplex) => Promise<number> } = {
  'parcel-delivery': runParcelDelivery,
};

export default async function subprocessEntrypoint(subprocessName: string): Promise<void> {
  const subprocessCallback = SUBPROCESSES[subprocessName];

  let exitCode: number;

  if (subprocessCallback) {
    await runStartup(subprocessName);

    try {
      exitCode = await subprocessCallback(await makeParentStream());
    } catch (err) {
      const logger = Container.get(LOGGER);
      logger.fatal({ err }, 'Unhandled exception in subprocess');
      exitCode = 128;
    }
  } else {
    exitCode = 129;
  }

  process.exit(exitCode);
}
