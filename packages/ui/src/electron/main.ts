import { fork } from 'child_process';
import { app, BrowserWindow, Menu, Tray } from 'electron';
import path from 'path';
import WebSocket from 'ws';
import { ConnectionStatus, pollConnectionStatus } from '../ipc/connectionStatus';
import { ServerMessage, ServerMessageType } from '../ipc/message';
import logo from './assets/logo.png';
import buildMenu from './menu';
import buildTray from './tray';

const logoPath = path.join(app.getAppPath(), logo);

let mainWindow: BrowserWindow | null = null;
let token: string = 'TOKEN';
let tray: Tray | null = null;
let closeWebSocket: (() => void) | null = null;

// Launch the daemon process and listen for a token via IPC
const server = fork(path.join(app.getAppPath(), 'daemon/build/bin/gateway-daemon.js'), {
  cwd: path.join(app.getAppPath(), 'daemon/'),
  env: { ...process.env, GATEWAY_FORKED_FROM_UI: 'true' },
});
server.on('close', (code: number, _signal: string) => {
  if (code !== null) {
    app.exit(code);
  }
});
server.on('message', (message: ServerMessage) => {
  if (message.type === ServerMessageType.TOKEN_MESSAGE) {
    token = message.value;
    startApp();
  }
});

/*
 * startApp
 * Configure the electron app and open the UI.
 * Called after the daemon has started and generated an auth token.
 */
async function startApp(): Promise<void> {
  await app.whenReady();

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

  // TODO: if auto-launch on startup, don't open the window?
  showMainWindow();

  // Configure the application menu
  const menu = buildMenu(showMainWindow, showSettings, showAbout, showLibraries);
  Menu.setApplicationMenu(menu);

  // Configure the task bar icon
  tray = buildTray(logoPath, showMainWindow);
  updateTray();
}

/*
 * showMainWindow
 * Shows the main window if it exists, otherwise create a new one
 */
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

  // load the html of the app, pass the token via query param
  mainWindow.loadFile('app.html', { query: { token } });

  mainWindow.on('closed', (): void => {
    // Emitted when the window is closed. After you have received this event you should remove the
    // reference to the window and avoid using it any more.
    mainWindow = null;
  });
}

/*
 * showSettings
 * Shows the main window and sends a signal to open the settings UI
 */
function showSettings(): void {
  showMainWindow();
  if (mainWindow) {
    mainWindow.webContents.send('show-public-gateway');
  }
}

/*
 * showAbout
 * Shows the about page in its own window
 */
function showAbout(): void {
  const win = new BrowserWindow({
    height: 320,
    icon: logoPath,
    resizable: false,
    title: 'About Awala',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: 400,
  });

  win.setMenuBarVisibility(false);
  win.loadFile('about.html');
}

/*
 * showLibraries
 * Shows the list of libraries in its own window
 */
function showLibraries(): void {
  const win = new BrowserWindow({
    height: 500,
    icon: logoPath,
    title: 'Open Source Libraries',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
    },
    width: 500,
  });

  win.setMenuBarVisibility(false);
  win.loadFile('libraries.html');
}

/*
 * updateTray
 * Opens a websocket to the daemon and streams the connection status,
 * then sets it as the tool tip text for the task bar icon.
 */
async function updateTray(): Promise<void> {
  if (token && tray) {
    tray.setToolTip('Connection status...');
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
