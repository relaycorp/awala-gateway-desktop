import { Container } from 'typedi';

import { DBPrivateKeyStore } from './DBPrivateKeyStore';
import { setUpTestDBConnection } from '../testUtils/db';

setUpTestDBConnection();

test('Dependency injection should be configured properly', () => {
  Container.get(DBPrivateKeyStore);
});
