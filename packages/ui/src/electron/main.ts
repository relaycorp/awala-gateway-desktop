import { fork } from 'child_process';
import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import ServerMessage from '../ipc/message';
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

  // Launch the daemon process and get a token via IPC
  const server = fork(path.join(app.getAppPath(), 'daemon/build/bin/gateway-daemon.js'));
  server.on('message', (message: ServerMessage) => {
    // console.log('Token from server', message.token);
    win.webContents.send('token', message.token);
  });

  app.on('window-all-closed', (event: Event) => {
    // Override the default behavior to quit the app,
    // keep the daemon running in the background.
    event.preventDefault();
  });
  app.on('will-quit', () => {
    // User hit Cmd+Q or app.quit() was called.
    server.kill(); // Stops the child process
  });
});
