import { Container, Token } from 'typedi';

export function makeConfigTokenEphemeral(configToken: Token<string>): void {
  const removeToken = () => {
    Container.remove(configToken);
  };
  beforeEach(removeToken);
  afterAll(removeToken);
}
