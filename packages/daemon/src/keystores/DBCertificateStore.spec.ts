import { Container } from 'typedi';

import { DBCertificateStore } from './DBCertificateStore';

test('Dependency injection should be configured properly', () => {
  Container.get(DBCertificateStore);
});
