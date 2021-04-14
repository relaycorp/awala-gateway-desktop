import { fork } from 'child_process';
import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import ServerMessage from '../ipc/message';
import buildMenu from './menu';

let mainWindow: BrowserWindow | null = null;
let token: string | null = null;

// Launch the daemon process and listen for a token via IPC
const server = fork(path.join(app.getAppPath(), 'daemon/build/bin/gateway-daemon.js'), {
  cwd: path.join(app.getAppPath(), 'daemon/'),
});
server.on('message', (message: ServerMessage) => {
  token = message.token;
  sendToken();
});
server.on('error', (_err: Error) => {
  app.quit();
});

app.on('ready', (): void => {
  // TODO: if auto-launch on startup, don't open the window?
  showMainWindow();

  Menu.setApplicationMenu(buildMenu(showSettings));

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

function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.focus();
    return;
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    height: 700,
    title: 'Awala',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: 900,
  });

  // and load the index.html of the app.
  mainWindow.loadFile('app.html');
  sendToken();

  mainWindow.on('closed', (): void => {
    // Emitted when the window is closed. After you have received this event you should remove the
    // reference to the window and avoid using it any more.
    mainWindow = null;
  });
}

function sendToken(): void {
  if (token && mainWindow) {
    mainWindow.webContents.send('token', token);
  }
}

function showSettings(): void {
  showMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('show-public-gateway');
  }
}
