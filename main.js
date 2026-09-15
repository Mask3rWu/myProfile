const { app, BrowserWindow, ipcMain, clipboard, shell, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

let win = null;
let settings = null;
let tray = null;
let isQuitting = false;
let tipWin = null;      // 独立的使用说明悬浮窗（可脱离主窗边界，跟随鼠标右下角）
let tipSize = null;     // 悬浮窗内容实际尺寸（加载完成后测得）

// ---- 贴边收缩：拖到屏幕左/右边缘松开后，缩成一个小圆角矩形按钮，点它还原 ----
const CHIP_W = 35;             // 收缩成的小按钮宽度（方形，左右对称）
const CHIP_H = 35;             // 收缩成的小按钮高度
const EDGE_TRIGGER = 8;        // 窗口边缘距屏幕边界多少像素以内判定为「贴边」
const EXPAND_COOLDOWN = 700;   // 程序化位移后短暂忽略 moved，避免收缩与展开互相触发
let collapsed = false;         // 是否处于收缩态
let restoreBounds = null;      // 收缩前的窗口 bounds，展开时还原
let origMin = null;            // 收缩前的窗口最小尺寸 [w, h]，还原时恢复
let collapseTimer = null;      // moved 停止后的防抖定时器
let lastSetBoundsAt = 0;       // 最近一次程序化 setBounds 的时间戳（冷却用）

// ---- 自定义窗口拖动：不依赖系统标题栏拖动，从而避开 Win11 的贴靠（拖到边缘自动半屏放大）----
let winDrag = null;            // { offX, offY } 抓取点相对窗口左上角的偏移

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
    // 收缩态下持久化收缩前的 bounds，避免下次启动变成一条窄条
    const b = collapsed && restoreBounds ? restoreBounds : win.getBounds();
    fs.writeFileSync(winStatePath, JSON.stringify(b));
  } catch {}
}

// ---- 贴边收缩逻辑 ----

function currentWorkArea() {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

// 记录程序化 setBounds 的时间，抑制随后的自动贴边判定（防止缩放互触发）
function setBoundsSafe(b) {
  lastSetBoundsAt = Date.now();
  if (win && !win.isDestroyed()) win.setBounds(b);
}

// moved 停止（用户松手）150ms 后触发：若窗口贴着屏幕左/右边缘则缩入
function maybeCollapse() {
  if (!win || win.isDestroyed() || collapsed) return;
  if (Date.now() - lastSetBoundsAt < EXPAND_COOLDOWN) return; // 刚被程序化移动过，跳过
  const wa = currentWorkArea();
  const b = win.getBounds();
  const dLeft = b.x - wa.x;
  const dRight = wa.x + wa.width - (b.x + b.width);
  console.log('[maybeCollapse] workArea=', wa, 'bounds=', b, 'dLeft=', dLeft, 'dRight=', dRight);
  if (Math.abs(dLeft) <= EDGE_TRIGGER) collapseTo('left');
  else if (Math.abs(dRight) <= EDGE_TRIGGER) collapseTo('right');
}

// 收缩：记下原尺寸并缩成一个贴在落点边缘的小圆角矩形按钮，竖直方向相对原窗口居中
function collapseTo(edge) {
  if (collapsed) return;
  const b = win.getBounds();
  restoreBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  origMin = win.getMinimumSize();
  collapsed = true;
  win.setMinimumSize(0, 0); // 允许 CHIP_W 小按钮，避免被 minWidth 钳制
  win.setResizable(false);  // 收缩态只留一个按钮，禁掉拖边框改变大小
  const wa = currentWorkArea();
  // 收缩按钮始终完整位于工作区内，左右两侧都保留完整的 35×35 圆角矩形。
  const desiredX = edge === 'left' ? wa.x : wa.x + wa.width - CHIP_W;
  const x = Math.max(wa.x, Math.min(desiredX, wa.x + wa.width - CHIP_W));
  // 在原窗口竖直范围内取中并夹紧在工作区内
  const y = Math.min(Math.max(b.y + (b.height - CHIP_H) / 2, wa.y), wa.y + wa.height - CHIP_H);
  winDrag = null; // 点按钮还原时才收起，避免拖动残留
  setBoundsSafe({ x, y, width: CHIP_W, height: CHIP_H });
  // Windows 最终采用的尺寸可能受原生窗口约束影响，贴边必须以实际尺寸为准。
  const actual = win.getBounds();
  win.setPosition(
    edge === 'left' ? wa.x : wa.x + wa.width - actual.width,
    Math.round(Math.max(wa.y, Math.min(y, wa.y + wa.height - actual.height)))
  );
  console.log('[collapse] edge=', edge, 'requested=', CHIP_W + 'x' + CHIP_H, 'actual=', win.getBounds());
  if (win && !win.isDestroyed()) win.webContents.send('window:collapsed', edge);
}

// 还原：恢复收缩前的位置与尺寸
function expandFromEdge() {
  if (!collapsed || !restoreBounds) return;
  const b = restoreBounds;
  collapsed = false;
  win.setMinimumSize(origMin ? origMin[0] : 200, origMin ? origMin[1] : 200);
  win.setResizable(true);
  restoreBounds = null;
  origMin = null;
  setBoundsSafe(b);
  if (win && !win.isDestroyed()) {
    win.webContents.send('window:expanded');
    win.show();
    win.focus();
  }
}

// ---- 自定义拖动：渲染层捕获鼠标，主进程用光标坐标跟随，不触发系统贴靠 ----
function dragStart() {
  if (!win || win.isDestroyed()) return;
  winDrag = null;
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  winDrag = { offX: c.x - wx, offY: c.y - wy }; // 抓取点距窗口左上角的偏移
}
const MAGNET = 12; // 拖动时窗口边缘距屏幕左/右侧多近开始吸附贴齐
function dragMove() {
  if (!winDrag || !win || win.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  const wa = currentWorkArea();
  const width = win.getBounds().width;
  let x = c.x - winDrag.offX;
  let y = c.y - winDrag.offY;
  // 收缩态允许上下移动，但始终保持按钮完整位于工作区内。
  if (collapsed) {
    // 收缩态只允许在屏幕内移动，避免按钮的一侧滑出屏幕后被裁切。
    x = Math.max(wa.x, Math.min(x, wa.x + wa.width - width));
    y = Math.max(wa.y, Math.min(y, wa.y + wa.height - win.getBounds().height));
  }
  // 左/右边缘磁性吸附：靠近屏幕左右边界时贴齐，配合松手后的贴边收缩
  // （setPosition 无系统边界阻力，若不吸附，窗口会滑出屏幕、落点离边缘过远而判不到贴边）
  if (x <= wa.x + MAGNET) x = wa.x;                                  // 靠近左边缘 → 贴齐左侧
  else if (x + width >= wa.x + wa.width - MAGNET) x = wa.x + wa.width - width; // 靠近右边缘 → 贴齐右侧
  win.setPosition(Math.round(x), Math.round(y));
  if (collapsed && win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send('window:edge-position', {
      x: Math.round(x),
      width,
      workAreaX: wa.x,
      workAreaWidth: wa.width
    });
  }
}
function dragEnd() {
  // 拖动结束：自定义拖动(setPosition)不派发 moved 事件，这里显式基于落点判定贴边收缩
  winDrag = null;
  setTimeout(() => {
    saveWinState();
    maybeCollapse(); // 落点贴到左/右边缘即缩入
  }, 120); // 略等一拍，确保最后一次 setPosition 已落地
  console.log('[dragEnd]', win.getBounds());
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
    // Windows 普通无边框窗口仍会把 35×35 撑到系统最小尺寸（如 48×39）。
    // 透明窗口避开这个限制，也让收缩按钮四角外真正透明。
    transparent: true,
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
  // 贴边检测：拖动过程中 moved 持续触发，停止（松手）150ms 后再判断是否贴边缩入
  win.on('moved', () => {
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(maybeCollapse, 150);
  });
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
    // 点击收缩条箭头时还原窗口
    ipcMain.on('window:expand', expandFromEdge);
    // 自定义窗口拖动（绕过系统贴靠）
    ipcMain.on('window:drag-start', dragStart);
    ipcMain.on('window:drag-move', dragMove);
    ipcMain.on('window:drag-end', dragEnd);

    createWindow();
    createTray();
  });

  app.on('window-all-closed', () => app.quit());
}
