import { app, BrowserWindow, Menu, MenuItemConstructorOptions } from 'electron';

const isMac = process.platform === 'darwin';

const developerMenu = {
  label: 'Developer',
  submenu: [
    {
      accelerator: isMac ? 'Alt+Cmd+I' : 'Alt+Shift+I',
      click: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          win.webContents.toggleDevTools();
        }
      },
      label: 'Open Dev Tools',
    },
    {
      accelerator: isMac ? 'Cmd+R' : 'Ctrl+R',
      click: () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) {
          win.webContents.reload();
        }
      },
      label: 'Reload',
    },
  ],
};

export default function buildMenu(
  showMainWindow: () => void,
  showSettings: () => void,
  showAbout: () => void,
  showLibraries: () => void,
): Menu {
  return Menu.buildFromTemplate([
    makeMainMenu(showMainWindow),
    { role: 'editMenu' },
    {
      label: 'Settings',
      submenu: [
        {
          accelerator: isMac ? 'Cmd+,' : undefined,
          click: showSettings,
          label: 'Public Gateway...',
        },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          click: showAbout,
          label: 'About Awala',
        },
        {
          click: showLibraries,
          label: 'Open Source Libraries',
        },
      ],
    },
    ...(app.isPackaged ? [] : [developerMenu]),
  ]);
}

function makeMainMenu(showMainWindow: () => void): MenuItemConstructorOptions {
  const openAppItem = {
    click: showMainWindow,
    label: 'Open Awala',
  };
  const topItems = isMac ? [openAppItem] : [];
  return {
    label: isMac ? 'Awala' : 'File',
    submenu: [...topItems, { role: 'close' }, { role: 'quit' }],
  };
}
