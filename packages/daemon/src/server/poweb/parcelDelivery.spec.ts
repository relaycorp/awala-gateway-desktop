import { useTemporaryAppDirs } from '../../testUtils/appDirs';
import { setUpTestDBConnection } from '../../testUtils/db';
import { testDisallowedMethods } from '../../testUtils/http';
import { makeMockLoggingFixture } from '../../testUtils/logging';
import { makeServer } from '../index';

const ENDPOINT_URL = '/v1/parcels';

const mockLogging = makeMockLoggingFixture();

setUpTestDBConnection();
useTemporaryAppDirs();

describe('Disallowed methods', () => {
  testDisallowedMethods(['POST'], ENDPOINT_URL, () => makeServer(mockLogging.logger));
});
