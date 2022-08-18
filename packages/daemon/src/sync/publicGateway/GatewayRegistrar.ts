import { UnreachableResolverError } from '@relaycorp/relaynet-core';
import { minutesToSeconds, subDays } from 'date-fns';
import { EventEmitter } from 'events';
import { Logger } from 'pino';
import { pipeline } from 'streaming-iterables';
import { Inject, Service } from 'typedi';

import { Config, ConfigKey } from '../../Config';
import { DEFAULT_INTERNET_GATEWAY } from '../../constants';
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
   * @throws InternetAddressingError if the DNS lookup or DNSSEC verification failed
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
    await this.config.set(ConfigKey.INTERNET_GATEWAY_ADDRESS, publicGatewayAddress);
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
        await this.register(DEFAULT_INTERNET_GATEWAY);
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
    let internetGatewayAddress = channel.internetGatewayInternetAddress;
    let certificateExpiryDate = channel.nodeDeliveryAuth.expiryDate;
    const updatePublicGateway = async (
      newPublicGatewayPublicAddress: string,
      newCertificateExpiryDate: Date,
    ) => {
      internetGatewayAddress = newPublicGatewayPublicAddress;
      certificateExpiryDate = newCertificateExpiryDate;
    };
    this.internalEvents.on('registration', updatePublicGateway);

    const logger = this.logger;

    const internalEvents = this.internalEvents;
    async function* emitRenewal(): AsyncIterable<void> {
      while (true) {
        const sleepAbortionController = new AbortController();
        const abortSleep = () => {
          sleepAbortionController.abort();
        };
        internalEvents.once('registration', abortSleep);

        const nextRenewalDate = subDays(certificateExpiryDate, 90);
        logger.info({ nextRenewalDate }, 'Scheduling registration renewal');
        await sleepUntilDate(nextRenewalDate, sleepAbortionController.signal);

        internalEvents.removeListener('registration', abortSleep);

        if (!sleepAbortionController.signal.aborted) {
          yield;
        }
      }
    }

    async function* continuouslyRenew(emissions: AsyncIterable<void>): AsyncIterable<void> {
      for await (const _ of emissions) {
        const publicGatewayAwareLogger = logger.child({
          publicGatewayPublicAddress: internetGatewayAddress,
        });
        try {
          certificateExpiryDate = await privateGateway.registerWithPublicGateway(
            internetGatewayAddress!,
          );
        } catch (err) {
          if (err instanceof UnreachableResolverError) {
            publicGatewayAwareLogger.info(
              { err },
              'Could not renew registration; we seem to be disconnected from the Internet',
            );
          } else {
            publicGatewayAwareLogger.warn({ err }, 'Failed to renew registration');
          }
          await sleepSeconds(minutesToSeconds(30));
          continue;
        }

        publicGatewayAwareLogger.info(
          { certificateExpiryDate },
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
    return this.config.get(ConfigKey.INTERNET_GATEWAY_ADDRESS);
  }
}
