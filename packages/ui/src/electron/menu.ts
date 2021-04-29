import { BrowserWindow, Menu } from 'electron';

const isMac = process.platform === 'darwin';

export default function buildMenu(
  showMainWindow: () => void,
  showSettings: () => void,
  showAbout: () => void,
  showLibraries: () => void,
): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Awala',
      submenu: [
        {
          click: showMainWindow,
          label: 'Open Awala',
        },
        { role: 'close' },
        { role: 'quit' },
      ],
    },
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
    {
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
    },
  ]);
}
