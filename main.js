const { app, BrowserWindow, ipcMain, clipboard, shell, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let settings = null;
let tray = null;
let isQuitting = false;

const iconPath = path.join(__dirname, 'icon.png');

const appDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
const settingsPath = path.join(appDir, 'settings.json');
const defaultSettingsPath = path.join(__dirname, 'default-settings.json');
const winStatePath = path.join(appDir, 'win-state.json');

function loadSettings() {
  return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
}

function ensureSettings() {
  if (!fs.existsSync(settingsPath)) {
    fs.copyFileSync(defaultSettingsPath, settingsPath);
  }
  settings = loadSettings();
}

function loadWinState() {
  try {
    return JSON.parse(fs.readFileSync(winStatePath, 'utf8'));
  } catch {
    return {};
  }
}

function saveWinState() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(winStatePath, JSON.stringify(win.getBounds()));
  } catch {}
}

function createWindow() {
  const state = loadWinState();
  win = new BrowserWindow({
    width: settings.defaultWidth || 250,
    height: settings.defaultHeight || 250,
    x: state.x,
    y: state.y,
    minWidth: 200,
    minHeight: 200,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => {
    win.setAlwaysOnTop(true, 'floating');
    win.show();
  });
  // 关闭窗口时最小化到托盘，而非退出；<退出>统一从托盘菜单触发
  win.on('close', (e) => {
    saveWinState();
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) win.hide();
  else { win.show(); win.focus(); }
}

function createTray() {
  tray = new Tray(iconPath);
  tray.setToolTip('简历速填');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => toggleWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', () => toggleWindow());
}

function watchSettings() {
  fs.watchFile(settingsPath, { interval: 600 }, () => {
    try {
      settings = loadSettings();
      if (win && !win.isDestroyed()) {
        win.webContents.send('config:changed', settings);
      }
    } catch (e) {
      console.error('settings parse error:', e.message);
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.myprofile.tray'); // 保证托盘图标分组/通知走自定义图标
    ensureSettings();
    watchSettings();

    ipcMain.handle('config:load', () => settings);
    ipcMain.handle('config:reload', () => {
      settings = loadSettings();
      return settings;
    });
    ipcMain.handle('config:open', () => shell.openPath(settingsPath));
    ipcMain.handle('config:set-top', (_e, on) => {
      if (!win || win.isDestroyed()) return on;
      win.setAlwaysOnTop(on, 'floating');
      return on;
    });
    ipcMain.handle('clipboard:write', (_e, text) => {
      clipboard.writeText(text);
    });
    ipcMain.handle('window:close', () => {
      if (win && !win.isDestroyed()) win.close();
    });

    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => app.quit());
}
