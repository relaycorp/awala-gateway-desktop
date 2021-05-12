import buildMenu from './menu';

describe('buildMenu', () => {
  const showMainWindow = jest.fn();
  const showSettings = jest.fn();
  const showAbout = jest.fn();
  const showLibraries = jest.fn();
  test('returns', async () => {
    buildMenu(showMainWindow, showSettings, showAbout, showLibraries);
  });
});
