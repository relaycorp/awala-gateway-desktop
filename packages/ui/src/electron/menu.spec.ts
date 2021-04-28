import buildMenu from './menu';

describe('buildMenu', () => {
  const showMainWindow = jest.fn();
  const showSettings = jest.fn();
  test('returns', async () => {
    buildMenu('', showMainWindow, showSettings);
  });
});
