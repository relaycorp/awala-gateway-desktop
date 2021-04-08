import { BrowserWindow, MenuItemConstructorOptions } from 'electron';

export default function buildMenuTemplate(mainWindow: BrowserWindow): MenuItemConstructorOptions[] {
  return [
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'Settings',
      submenu: [
        {
          accelerator: process.platform === 'darwin' ? 'Cmd+,' : undefined,
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('show-public-gateway');
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
              height: 500,
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
              webPreferences: {
                contextIsolation: false,
                nodeIntegration: true,
              },
              width: 400,
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
          accelerator: process.platform === 'darwin' ? 'Alt+Cmd+I' : 'Alt+Shift+I',
          click: async () => {
            mainWindow.webContents.toggleDevTools();
          },
          label: 'Open Dev Tools',
        },
        {
          accelerator: process.platform === 'darwin' ? 'Cmd+R' : 'Ctrl+R',
          click: async () => {
            mainWindow.webContents.reload();
          },
          label: 'Reload',
        },
      ],
    },
  ];
}
