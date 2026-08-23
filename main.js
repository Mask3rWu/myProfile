const { app, BrowserWindow, ipcMain, clipboard, shell, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let settings = null;
let tray = null;
let isQuitting = false;
let tipWin = null;      // 独立的使用说明悬浮窗（可脱离主窗边界，跟随鼠标右下角）
let tipSize = null;     // 悬浮窗内容实际尺寸（加载完成后测得）

const iconPath = path.join(__dirname, 'icon.png');

// 配置统一存到 Electron 的 userData 目录（%APPDATA%/my-profile），打包为 portable exe 时 exe 运行在临时目录，
// 若用 app.isPackaged ? __dirname 会指向 %TEMP%，导致配置丢失或难找。userData 路径固定且可持久化。
//
// 开发（调试）时未打包，改用项目根目录的 settings.json，方便随时编辑根目录下的那份；
// 打包后仍回归 userData。文件缺失时回退到 userData 目录，避免读取报错。
const DATA_DIR = app.getPath('userData');
const projectSettingsPath = path.join(__dirname, 'settings.json');
const settingsPath =
  !app.isPackaged && fs.existsSync(projectSettingsPath)
    ? projectSettingsPath
    : path.join(DATA_DIR, 'settings.json');
const defaultSettingsPath = path.join(__dirname, 'default-settings.json');
const winStatePath = path.join(DATA_DIR, 'win-state.json');

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
      hideTip();
    }
  });
}

function toggleWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) { win.hide(); hideTip(); }
  else { win.show(); win.focus(); }
}

// ---- 使用说明悬浮窗：独立的无边框透明窗，可在主窗边界之外显示，位置跟随鼠标右下角 ----
const TIP_MARGIN = 16;   // 面板四周为阴影预留的透明边距
const TIP_GAP_X = 16;    // 鼠标右下角偏移（与原生 title 一致的落点）
const TIP_GAP_Y = 22;
const TIP_SCREEN_INSET = 8; // 面板与屏幕工作区边缘的最小间距

// 首次引入时窗口尺寸未知，用 Promise 保证“加载并测量”之后再展示
function ensureTipWindow() {
  if (tipWin && !tipWin.isDestroyed()) return Promise.resolve();
  tipWin = new BrowserWindow({
    width: 320,
    height: 400,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  tipWin.loadFile('tooltip.html');
  tipWin.setIgnoreMouseEvents(true); // 纯展示，不拦截鼠标
  tipWin.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); tipWin.hide(); }
  });
  return new Promise((resolve) => {
    tipWin.webContents.once('did-finish-load', async () => {
      // 测量内容并收紧窗口尺寸，避免出现滚动条 / 内容被截断
      try {
        const { width, height } = await tipWin.webContents.executeJavaScript(
          "(() => { const r = document.querySelector('.help-tip').getBoundingClientRect();" +
          " return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()"
        );
        tipSize = { w: width + TIP_MARGIN * 2, h: height + TIP_MARGIN * 2 };
      } catch {}
      resolve();
    });
  });
}

async function showTip() {
  await ensureTipWindow();
  const sz = tipSize || { w: 320, h: 400 };
  const panelW = sz.w - TIP_MARGIN * 2;
  const panelH = sz.h - TIP_MARGIN * 2;

  const c = screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(c).workArea; // 光标所在显示器的工作区

  // 默认落在鼠标右下角；放不下时翻到鼠标的左侧/上方，最后夹紧在工作区内
  let tx = c.x + TIP_GAP_X;
  let ty = c.y + TIP_GAP_Y;
  if (tx + panelW > wa.x + wa.width) tx = c.x - TIP_GAP_X - panelW;
  if (ty + panelH > wa.y + wa.height) ty = c.y - TIP_GAP_Y - panelH;
  tx = Math.max(wa.x + TIP_SCREEN_INSET, Math.min(tx, wa.x + wa.width - panelW - TIP_SCREEN_INSET));
  ty = Math.max(wa.y + TIP_SCREEN_INSET, Math.min(ty, wa.y + wa.height - panelH - TIP_SCREEN_INSET));

  tipWin.setSize(sz.w, sz.h);
  tipWin.setPosition(tx - TIP_MARGIN, ty - TIP_MARGIN);
  tipWin.setAlwaysOnTop(true, 'pop-up-menu');
  tipWin.showInactive();
}

function hideTip() {
  if (tipWin && !tipWin.isDestroyed()) tipWin.hide();
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
    // 编辑模式保存：整份配置写回文件。写入后 fs.watchFile 会触发 config:changed 让渲染层自动刷新
    ipcMain.handle('config:save', (_e, data) => {
      try {
        fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2), 'utf8');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    });
    // 打开设置中指定的文件夹（配置文件靠 Settings 文件里的 openFolder 字段指定）
    ipcMain.handle('folder:open', () => {
      const dir = settings.openFolder;
      if (!dir) return { ok: false };
      return shell.openPath(dir).then((err) => ({ ok: !err, error: err || null }));
    });
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
    ipcMain.on('help:tip-show', () => showTip());
    ipcMain.on('help:tip-hide', () => hideTip());

    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => app.quit());
}
