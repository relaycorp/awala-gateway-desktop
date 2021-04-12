import { BrowserWindow, Menu } from 'electron';
import logo from './assets/logo.png';

const isMac = process.platform === 'darwin';

export default function buildMenuTemplate(mainWindow: BrowserWindow): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'Awala',
      submenu: [{ role: 'close' }, { role: 'quit' }],
    },
    { role: 'editMenu' },
    {
      label: 'Settings',
      submenu: [
        {
          accelerator: isMac ? 'Cmd+,' : undefined,
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-public-gateway');
              mainWindow.focus();
            }
          },
          label: 'Public Gateway...',
        },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          click: async () => {
            const win = new BrowserWindow({
              height: 320,
              icon: logo,
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
          click: async () => {
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
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) {
              win.webContents.toggleDevTools();
            }
          },
          label: 'Open Dev Tools',
        },
        {
          accelerator: isMac ? 'Cmd+R' : 'Ctrl+R',
          click: async () => {
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
