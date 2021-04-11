import { app, BrowserWindow, Menu } from 'electron';
import buildMenuTemplate from './menu';

app.on('ready', function createWindow(): void {
  // Create the browser window.
  const win = new BrowserWindow({
    height: 700,
    title: 'Awala',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: 900,
  });

  // and load the index.html of the app.
  win.loadFile('app.html');

  Menu.setApplicationMenu(buildMenuTemplate(win));
});
