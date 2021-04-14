import { Container, Token } from 'typedi';

export function mockToken<T>(token: Token<T>): void {
  let originalValue: T;

  beforeAll(() => {
    if (Container.has(token)) {
      originalValue = Container.get(token);
    }
  });

  const restoreOriginalValue = () => {
    if (!Container.has(token)) {
      return;
    }
    if (originalValue === undefined) {
      Container.remove(token);
    } else {
      Container.set(token, originalValue);
    }
  };
  beforeEach(restoreOriginalValue);
  afterAll(restoreOriginalValue);
}
