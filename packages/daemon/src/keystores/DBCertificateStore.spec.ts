import { Container } from 'typedi';

import { DBCertificateStore } from './DBCertificateStore';
import { setUpTestDBConnection } from '../testUtils/db';

setUpTestDBConnection();

test('Dependency injection should be configured properly', () => {
  Container.get(DBCertificateStore);
});
