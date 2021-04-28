import { fork } from 'child_process';
import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
import WebSocket from 'ws';
import { ConnectionStatus, pollConnectionStatus } from '../ipc/connectionStatus';
import { ServerMessage, ServerMessageType } from '../ipc/message';
import logo from './assets/logo.png';
import buildMenu from './menu';
import buildTray from './tray';

let mainWindow: BrowserWindow | null = null;
let token: string | null = null;
let tray: Tray | null = null;
let closeWebSocket: (() => void) | null = null;

// Launch the daemon process and listen for a token via IPC
const server = fork(path.join(app.getAppPath(), 'daemon/build/bin/gateway-daemon.js'), {
  cwd: path.join(app.getAppPath(), 'daemon/'),
});
server.on('message', setToken);
server.on('error', (_err: Error) => {
  app.quit();
});

app.on('ready', (): void => {
  // TODO: if auto-launch on startup, don't open the window?
  // TODO: wait for the server to be ready. if too early, the websocket is refused.
  showMainWindow();

  const logoPath = path.join(app.getAppPath(), logo);
  Menu.setApplicationMenu(buildMenu(logoPath, showMainWindow, showSettings));

  app.on('window-all-closed', (event: Event) => {
    // Override the default behavior to quit the app,
    // keep the daemon running in the background.
    event.preventDefault();
  });
  app.on('will-quit', () => {
    // User hit Cmd+Q or app.quit() was called.
    if (closeWebSocket) {
      closeWebSocket();
    }
    server.kill(); // Stops the child process
  });

  tray = buildTray(logoPath, showMainWindow);
  tray.setToolTip('Connection status...');
  updateToolTip();
});

function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
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

async function updateToolTip(): Promise<void> {
  if (token && tray) {
    const { promise, abort } = pollConnectionStatus(token);
    try {
      for await (const item of promise) {
        tray.setToolTip(ConnectionStatus[item]);
      }
    } catch (err) {
      if (err.target instanceof WebSocket) {
        abort();
      } else {
        throw err;
      }
    }
    closeWebSocket = abort;
  }
}

function setToken(message: ServerMessage): void {
  if (message.type === ServerMessageType.TOKEN_MESSAGE) {
    token = message.value;
    sendToken();
    if (tray && !closeWebSocket) {
      updateToolTip();
    }
  }
}
