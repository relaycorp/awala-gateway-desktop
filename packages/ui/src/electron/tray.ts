import { Menu, nativeImage, Tray } from 'electron';

export default function buildTray(logo: string, showMainWindow: () => void): Tray {
  let trayIcon = nativeImage.createFromPath(logo);
  trayIcon = trayIcon.resize({ width: 16, height: 16 });
  const tray = new Tray(trayIcon);
  const contextMenu = Menu.buildFromTemplate([
    {
      click: showMainWindow,
      label: 'Open Awala',
    },
  ]);
  tray.setContextMenu(contextMenu);

  return tray;
}
