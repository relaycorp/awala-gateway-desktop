import buildMenu from './menu';

jest.mock('electron', () => {
  const realElectron = jest.requireActual('electron');
  return {
    ...realElectron,
    app: { isPackaged: true },
  };
});

describe('buildMenu', () => {
  const showMainWindow = jest.fn();
  const showSettings = jest.fn();
  const showAbout = jest.fn();
  const showLibraries = jest.fn();
  test('returns', async () => {
    buildMenu(showMainWindow, showSettings, showAbout, showLibraries);
  });
});
