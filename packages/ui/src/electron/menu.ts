import { BrowserWindow, Menu } from 'electron';

const isMac = process.platform === 'darwin';

export default function buildMenu(
  logo: string,
  showMainWindow: () => void,
  showSettings: () => void,
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
          click: () => {
            const win = new BrowserWindow({
              height: 320,
              icon: logo,
              resizable: false,
              title: 'About Awala',
              webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
              },
              width: 400,
            });

            // and load the index.html of the app.
            win.loadFile('about.html');
          },
          label: 'About Awala',
        },
        {
          click: () => {
            const win = new BrowserWindow({
              height: 500,
              icon: logo,
              title: 'Open Source Libraries',
              webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
              },
              width: 500,
            });

            // and load the index.html of the app.
            win.loadFile('libraries.html');
          },
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
