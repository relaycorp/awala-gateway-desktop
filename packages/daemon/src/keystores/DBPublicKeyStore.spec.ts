import { Container } from 'typedi';

import { setUpTestDBConnection } from '../testUtils/db';
import { DBPublicKeyStore } from './DBPublicKeyStore';

setUpTestDBConnection();

test('Dependency injection should be configured properly', () => {
  Container.get(DBPublicKeyStore);
});
