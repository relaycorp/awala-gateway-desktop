import { UnreachableResolverError } from '@relaycorp/relaynet-core';
import { subDays } from 'date-fns';
import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { pipeline } from 'streaming-iterables';
import { Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_PUBLIC_GATEWAY } from '../../constants';
import { sleepSeconds, sleepUntilDate } from '../../utils/timing';
import { PrivateGatewayManager } from '../../PrivateGatewayManager';
import { LOGGER } from '../../tokens';

@Service()
export class GatewayRegistrar {
  private readonly internalEvents = new EventEmitter();

  constructor(
    private config: Config,
    @Inject() private gatewayManager: PrivateGatewayManager,
    @Inject(LOGGER) private logger: Logger,
  ) {}

  /**
   * Register with the `publicGatewayAddress`.
   *
   * @param publicGatewayAddress
   * @throws UnreachableResolverError if DNS resolver is unreachable
   * @throws PublicAddressingError if the DNS lookup or DNSSEC verification failed
   * @throws NonExistingAddressError if the DNS+DNSSEC lookup succeeded but the address doesn't exist
   * @throws PublicGatewayProtocolError if the public gateways violates the protocol
   */
  public async register(publicGatewayAddress: string): Promise<void> {
    const currentPublicGatewayAddress = await this.getPublicGatewayAddress();
    if (currentPublicGatewayAddress === publicGatewayAddress) {
      this.logger.debug('Skipping registration with public gateway');
      return;
    }

    const privateGateway = await this.gatewayManager.getCurrent();
    const privateGatewayCertificateExpiryDate = await privateGateway.registerWithPublicGateway(
      publicGatewayAddress,
    );
    await this.config.set(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS, publicGatewayAddress);
    this.internalEvents.emit(
      'registration',
      publicGatewayAddress,
      privateGatewayCertificateExpiryDate,
    );
    this.logger.info(
      { privateGatewayCertificateExpiryDate, publicGatewayPublicAddress: publicGatewayAddress },
      'Successfully registered with public gateway',
    );
  }

  public async waitForRegistration(): Promise<void> {
    while (!(await this.isRegistered())) {
      try {
        await this.register(DEFAULT_PUBLIC_GATEWAY);
      } catch (err) {
        if (err instanceof UnreachableResolverError) {
          // The device may be disconnected from the Internet or the DNS resolver may be blocked.
          this.logger.debug(
            'Failed to register with public gateway because DNS resolver is unreachable',
          );
          await sleepSeconds(5);
        } else {
          this.logger.error({ err }, 'Failed to register with public gateway');
          await sleepSeconds(60);
        }
      }
    }
  }

  public async isRegistered(): Promise<boolean> {
    const publicGatewayAddress = await this.getPublicGatewayAddress();
    return publicGatewayAddress !== null;
  }

  public async *continuallyRenewRegistration(): AsyncIterable<void> {
    const privateGateway = await this.gatewayManager.getCurrent();

    const channel = await this.gatewayManager.getCurrentChannel();
    let publicGatewayPublicAddress = channel.publicGatewayPublicAddress;
    let certificateExpiryDate = channel.nodeDeliveryAuth.expiryDate;
    const updatePublicGateway = async (
      newPublicGatewayPublicAddress: string,
      newCertificateExpiryDate: Date,
    ) => {
      publicGatewayPublicAddress = newPublicGatewayPublicAddress;
      certificateExpiryDate = newCertificateExpiryDate;
    };
    this.internalEvents.on('registration', updatePublicGateway);

    const internalEvents = this.internalEvents;
    async function* emitRenewal(): AsyncIterable<void> {
      while (true) {
        const sleepAbortionController = new AbortController();
        const abortSleep = () => {
          sleepAbortionController.abort();
        };
        internalEvents.once('registration', abortSleep);

        const nextCheckDate = subDays(certificateExpiryDate, 90);
        await sleepUntilDate(nextCheckDate, sleepAbortionController.signal);

        internalEvents.removeListener('registration', abortSleep);

        if (!sleepAbortionController.signal.aborted) {
          yield;
        }
      }
    }

    const logger = this.logger;
    async function* continuouslyRenew(emissions: AsyncIterable<void>): AsyncIterable<void> {
      for await (const _ of emissions) {
        certificateExpiryDate = await privateGateway.registerWithPublicGateway(
          publicGatewayPublicAddress!,
        );
        logger.info(
          { publicGatewayPublicAddress, certificateExpiryDate },
          'Renewed certificate with public gateway',
        );
        yield;
      }
    }

    try {
      yield* await pipeline(emitRenewal, continuouslyRenew);
    } finally {
      this.internalEvents.removeListener('registration', updatePublicGateway);
    }
  }

  private getPublicGatewayAddress(): Promise<string | null> {
    return this.config.get(ConfigKey.PUBLIC_GATEWAY_PUBLIC_ADDRESS);
  }
}
