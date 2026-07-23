/**
 * ============================================================
 * main.js —— Electron 的【主进程】入口文件
 * ============================================================
 *
 * 关键设计：
 *   1. 点 × 关闭 → 隐藏到系统托盘，后台静默运行，不退出进程
 *   2. 右键托盘图标 →「退出 win新剪贴板」才能真正退出
 *   3. 托盘「设置...」→ 可自定义全局快捷键
 *   4. 开机自启 + 设置持久化（settings.json）
 * ============================================================
 */

const {
  app, BrowserWindow, globalShortcut, ipcMain,
  nativeTheme, clipboard, Tray, Menu, nativeImage
} = require('electron');
const path = require('path');
const fs = require('fs');

// ★ 禁用窗口动画，修复透明窗口 show/hide 时 GPU 上下文重建导致的白闪
//   参考：Electron issue #42523，官方在 v37.7.1+ 修复，此开关作为额外保险
app.commandLine.appendSwitch('wm-window-animations-disabled');

// --------------------------------------------------
// ★ 单实例锁：防止双击 exe 创建多个进程
//   如果已有实例在运行，退出当前进程并唤醒已有窗口
// --------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 已有实例收到第二个启动请求 → 显示窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// --------------------------------------------------
// 全局变量
// --------------------------------------------------
let mainWindow = null;
let settingsWindow = null;
let tray = null;
let isQuitting = false;
let currentShortcut = '';        // 当前生效的快捷键

// --------------------------------------------------
// 文件路径
// --------------------------------------------------
const DATA_DIR = app.getPath('userData');
const HISTORY_FILE = path.join(DATA_DIR, 'clipboard_history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// --------------------------------------------------
// 默认设置
// --------------------------------------------------
const DEFAULT_SETTINGS = {
  shortcut: 'CommandOrControl+Shift+V',
  folders: ['默认']
};

// --------------------------------------------------
// 设置文件的读写
// --------------------------------------------------
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (e) { console.error('读取设置失败：', e); }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    // 合并：读取当前设置，然后用新值覆盖，避免丢掉其他字段（如 folders）
    const current = loadSettings();
    const merged = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (e) { console.error('保存设置失败：', e); }
}

// --------------------------------------------------
// 卡通剪贴板 + 星标图标（托盘 16×16 / 应用 256×256）
// --------------------------------------------------

// 五角星顶点计算（中心在 cx,cy，外接圆半径 r）
function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (i * 2 * Math.PI / 5) - Math.PI / 2;
    pts.push([cx + r * Math.cos(outerAngle), cy + r * Math.sin(outerAngle)]);
    const innerAngle = outerAngle + Math.PI / 5;
    const ri = r * 0.38;
    pts.push([cx + ri * Math.cos(innerAngle), cy + ri * Math.sin(innerAngle)]);
  }
  return pts;
}

// 点是否在五角星内（射线法）
function pointInStar(px, py, star) {
  let inside = false;
  for (let i = 0, j = star.length - 1; i < star.length; j = i++) {
    const xi = star[i][0], yi = star[i][1];
    const xj = star[j][0], yj = star[j][1];
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

// 圆角矩形距离场（有符号距离：负值=内部，正值=外部）
function roundedRectSDF(x, y, rx, ry, rw, rh, cr) {
  const dx = Math.abs(x - rx) - rw;
  const dy = Math.abs(y - ry) - rh;
  const cx = Math.max(dx, 0);
  const cy = Math.max(dy, 0);
  return Math.sqrt(cx * cx + cy * cy) - cr;
}

// —— 系统托盘图标（16×16）——
function createTrayIcon() {
  const S = 16;
  const buf = Buffer.alloc(S * S * 4, 0);
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || x >= S || y < 0 || y >= S) return;
    const i = (y * S + x) * 4;
    buf[i] = r; buf[i+1] = g; buf[i+2] = b; buf[i+3] = a;
  };

  // 颜色
  const BODY    = [232, 213, 183];   // 米色纸
  const OUTLINE = [90,  72,  52];    // 深褐边框
  const CLIP    = [182, 184, 194];   // 银灰夹
  const CLIP_HL = [210, 212, 220];   // 夹子高光
  const STAR    = [255, 215,   0];   // 金星
  const LINE    = [208, 186, 155];   // 纸内横线

  // 剪贴板主体：圆角矩形 (x=2..13, y=4..14)，圆角≈2
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // 到圆角矩形 (cx=7.5,cy=9, w=5.5,h=5.5, cr=2.5) 的最近距离
      const d = roundedRectSDF(x + 0.5, y + 0.5, 7.5, 9, 5.5, 5.5, 2.5);
      if (d < 0) {
        if (d > -1.2) {
          // 边框
          const a = Math.round(Math.min(255, Math.max(0, -d * 200)));
          set(x, y, OUTLINE[0], OUTLINE[1], OUTLINE[2], a);
        } else {
          set(x, y, BODY[0], BODY[1], BODY[2]);
        }
      } else if (d < 1) {
        // 抗锯齿边缘
        const a = Math.round(Math.min(255, Math.max(0, (1 - d) * 200)));
        set(x, y, OUTLINE[0], OUTLINE[1], OUTLINE[2], a);
      }
    }
  }

  // 夹子（顶部）
  set(5, 2, CLIP[0], CLIP[1], CLIP[2]);
  set(6, 2, CLIP[0], CLIP[1], CLIP[2]);
  set(7, 2, CLIP[0], CLIP[1], CLIP[2]);
  set(8, 2, CLIP[0], CLIP[1], CLIP[2]);
  set(9, 2, CLIP[0], CLIP[1], CLIP[2]);
  set(5, 3, CLIP[0], CLIP[1], CLIP[2]);
  set(6, 3, CLIP_HL[0], CLIP_HL[1], CLIP_HL[2]); // 高光
  set(7, 3, CLIP_HL[0], CLIP_HL[1], CLIP_HL[2]);
  set(8, 3, CLIP[0], CLIP[1], CLIP[2]);
  set(9, 3, CLIP[0], CLIP[1], CLIP[2]);
  set(10,3, CLIP[0], CLIP[1], CLIP[2]);

  // 纸内横线（装饰）
  for (let x = 4; x <= 10; x++) set(x, 7, LINE[0], LINE[1], LINE[2]);
  for (let x = 4; x <= 10; x++) set(x,10, LINE[0], LINE[1], LINE[2]);

  // ★ 右上角五角星（约 4×4 像素）
  set(12, 3, STAR[0], STAR[1], STAR[2]);       // 尖顶
  set(11, 4, STAR[0], STAR[1], STAR[2]);
  set(12, 4, STAR[0], STAR[1], STAR[2]);
  set(13, 4, STAR[0], STAR[1], STAR[2]);
  set(12, 5, STAR[0], STAR[1], STAR[2]);       // 尖底
  set(11, 5, STAR[0], STAR[1], STAR[2]);
  set(13, 5, STAR[0], STAR[1], STAR[2]);

  return nativeImage.createFromBuffer(buf, { width: S, height: S });
}

// —— 应用图标（256×256，供打包用）——
function generateAppIcon() {
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const iconPath = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(iconPath)) return;

  const S = 256;
  const buf = Buffer.alloc(S * S * 4, 0);

  // 颜色
  const BODY    = [235, 218, 190];
  const OUTLINE = [80,  64,  48];
  const CLIP    = [176, 178, 192];
  const CLIP_HL = [210, 212, 224];
  const STAR    = [255, 215,   0];
  const STAR_HL = [255, 230,  80];
  const LINE    = [212, 192, 162];

  // 五角星顶点
  const star = starPoints(S * 0.82, S * 0.18, S * 0.12);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;

      // —— 剪贴板主体（圆角矩形）——
      // 内框位置：中心偏下，留出夹子空间
      const cr = S * 0.07;        // 圆角半径 ~18
      const bw = S * 0.38;        // 半宽 ~97
      const bh = S * 0.44;        // 半高 ~113
      const cx = S * 0.5;         // 中心 x
      const cy = S * 0.52;        // 中心 y（略偏下）

      const d = roundedRectSDF(x + 0.5, y + 0.5, cx, cy, bw, bh, cr);

      if (d < -1.5) {
        // 内部：米色纸
        buf[i] = BODY[0]; buf[i+1] = BODY[1]; buf[i+2] = BODY[2]; buf[i+3] = 255;

        // 纸内横线（浅）
        const relY = y - (cy - bh) + cr;
        if ((Math.abs(relY - bh * 0.42) < 1.5) || (Math.abs(relY - bh * 0.66) < 1.5)) {
          if (x > cx - bw * 0.7 && x < cx + bw * 0.7) {
            buf[i] = LINE[0]; buf[i+1] = LINE[1]; buf[i+2] = LINE[2];
          }
        }
      } else if (d < 0) {
        // 边框过渡区（d: -1.5 ~ 0）
        const t = -d / 1.5;
        buf[i]   = Math.round(OUTLINE[0] * (1 - t) + BODY[0] * t);
        buf[i+1] = Math.round(OUTLINE[1] * (1 - t) + BODY[1] * t);
        buf[i+2] = Math.round(OUTLINE[2] * (1 - t) + BODY[2] * t);
        buf[i+3] = 255;
      } else if (d < 2) {
        // 外边缘抗锯齿
        const a = Math.round(Math.min(255, Math.max(0, (2 - d) * 128)));
        buf[i] = OUTLINE[0]; buf[i+1] = OUTLINE[1]; buf[i+2] = OUTLINE[2]; buf[i+3] = a;
      }
    }
  }

  // —— 夹子 ——
  // 画在主体外顶部，近似圆角矩形
  const clipY1 = Math.round(cy - bh - cr * 0.5);
  const clipY2 = Math.round(cy - bh + cr * 1.2);
  const clipX1 = Math.round(cx - bh * 0.22);
  const clipX2 = Math.round(cx + bh * 0.22);

  for (let y = clipY1; y <= clipY2; y++) {
    for (let x = clipX1; x <= clipX2; x++) {
      if (x < 0 || x >= S || y < 0 || y >= S) continue;
      const dc = roundedRectSDF(x + 0.5, y + 0.5, (clipX1 + clipX2) / 2, (clipY1 + clipY2) / 2,
        (clipX2 - clipX1) / 2, (clipY2 - clipY1) / 2, 3);
      if (dc < 0) {
        const i = (y * S + x) * 4;
        // 顶部高光
        const isHighlight = y < clipY1 + (clipY2 - clipY1) * 0.4;
        if (isHighlight) {
          buf[i] = CLIP_HL[0]; buf[i+1] = CLIP_HL[1]; buf[i+2] = CLIP_HL[2]; buf[i+3] = 255;
        } else {
          buf[i] = CLIP[0]; buf[i+1] = CLIP[1]; buf[i+2] = CLIP[2]; buf[i+3] = 255;
        }
      }
    }
  }

  // —— ★ 五角星（右上角）——
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (pointInStar(x + 0.5, y + 0.5, star)) {
        const i = (y * S + x) * 4;
        // 星星颜色渐变（中心高亮）
        const distFromCenter = Math.sqrt((x - S * 0.82) ** 2 + (y - S * 0.18) ** 2);
        const t = Math.min(1, distFromCenter / (S * 0.08));
        buf[i]   = Math.round(STAR[0] * (1 - t) + STAR_HL[0] * t);
        buf[i+1] = Math.round(STAR[1] * (1 - t) + STAR_HL[1] * t);
        buf[i+2] = Math.round(STAR[2] * (1 - t) + STAR_HL[2] * t);
        buf[i+3] = 255;
      }
    }
  }

  // —— 输出为 BMP（electron-builder 可接受）——
  const fileSize = 54 + buf.length;
  const header = Buffer.alloc(54);
  header.write('BM', 0);
  header.writeUInt32LE(fileSize, 2);
  header.writeUInt32LE(54, 10);
  header.writeUInt32LE(40, 14);
  header.writeInt32LE(S, 18);
  header.writeInt32LE(-S, 22);
  header.writeUInt16LE(1, 26);
  header.writeUInt16LE(32, 28);
  header.writeUInt32LE(0, 30);
  header.writeUInt32LE(buf.length, 34);

  fs.writeFileSync(iconPath, Buffer.concat([header, buf]));
  console.log('【图标】已生成 assets/icon.png (卡通剪贴板 + ★)');

  // .ico 直接复制 BMP（electron-builder 会在构建时自动转换）
  const icoPath = path.join(assetsDir, 'icon.ico');
  fs.copyFileSync(iconPath, icoPath);
  console.log('【图标】已生成 assets/icon.ico');
}

// --------------------------------------------------
// 创建系统托盘
// --------------------------------------------------
function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('win新剪贴板 - 增强型剪贴板管理器');
  tray.on('double-click', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  const isAutoStart = app.getLoginItemSettings().openAtLogin;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏窗口',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
        if (mainWindow.isVisible()) { mainWindow.hide(); }
        else { mainWindow.show(); mainWindow.focus(); }
      }
    },
    { type: 'separator' },
    {
      label: '设置...',
      click: () => openSettingsWindow()
    },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoStart,
      click: (menuItem) => app.setLoginItemSettings({ openAtLogin: menuItem.checked })
    },
    { type: 'separator' },
    {
      label: '退出 win新剪贴板',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

// --------------------------------------------------
// 创建设置窗口
// --------------------------------------------------
function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const { screen } = require('electron');
  const p = screen.getPrimaryDisplay().workAreaSize;

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 340,
    x: Math.round((p.width - 420) / 2),
    y: Math.round((p.height - 340) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    show: false,
    parent: mainWindow,           // 依附于主窗口
    modal: false,
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));

  settingsWindow.once('ready-to-show', () => {
    settingsWindow.show();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// --------------------------------------------------
// 动态注册 / 重新注册全局快捷键
// --------------------------------------------------
function registerShortcut(accelerator) {
  if (!accelerator) return;
  globalShortcut.unregisterAll();

  // 优先尝试用户设置的快捷键
  if (globalShortcut.register(accelerator, toggleWindow)) {
    currentShortcut = accelerator;
    console.log(`【成功】已注册全局快捷键：${accelerator}`);
    return;
  }
  console.log(`【提示】${accelerator} 注册失败，尝试降级方案...`);

  // 降级方案列表（按顺序尝试）
  const fallbacks = [
    'CommandOrControl+Shift+V',
    'CommandOrControl+Alt+Z',
    'Alt+Shift+V',
    'Alt+Z'
  ];

  for (const fb of fallbacks) {
    if (fb === accelerator) continue; // 跳过已尝试的
    if (globalShortcut.register(fb, toggleWindow)) {
      currentShortcut = fb;
      console.log(`【成功】已降级注册快捷键：${fb}`);
      // 自动更新设置
      saveSettings({ shortcut: fb });
      return;
    }
  }

  console.log('【警告】所有快捷键均注册失败！请在设置中修改快捷键。');
}

// --------------------------------------------------
// 创建主窗口
// --------------------------------------------------
function createWindow() {
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  const windowWidth = 800;
  const windowHeight = 600;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    minWidth: 600,
    minHeight: 400,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    show: false,
    paintWhenInitiallyHidden: true,  // 隐藏时持续绘制，避免首次 show 白闪
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false   // 关键：隐藏时不节流，避免 show 时白闪
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // ★ 等待 ready-to-show + did-finish-load 同时触发后再 show，
  //   避免透明窗口首次渲染时的白闪（Electron issue #42523）
  let ready = false, finished = false;
  const tryShow = () => {
    if (ready && finished && mainWindow) {
      mainWindow.show();
      startClipboardWatcher();
    }
  };
  mainWindow.once('ready-to-show', () => { ready = true; tryShow(); });
  mainWindow.webContents.once('did-finish-load', () => { finished = true; tryShow(); });

  // 关闭 → 隐藏到托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --------------------------------------------------
// 剪贴板变化监控
// --------------------------------------------------
let lastClipboardText = '';
const POLL_INTERVAL_MS = 500;

function startClipboardWatcher() {
  lastClipboardText = clipboard.readText() || '';
  setInterval(() => {
    try {
      const text = clipboard.readText() || '';
      if (!text || text === lastClipboardText) return;
      lastClipboardText = text;

      const newItem = {
        id: Date.now(),
        text: text,
        createdAt: new Date().toISOString()
      };

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('new-clipboard-item', newItem);
      }
    } catch (error) {
      console.error('剪贴板监控出错：', error);
    }
  }, POLL_INTERVAL_MS);
}

// --------------------------------------------------
// 显示 / 隐藏窗口
// --------------------------------------------------
function toggleWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ============================================================
//  IPC 处理
// ============================================================

ipcMain.handle('write-clipboard', async (event, text) => {
  clipboard.writeText(text);
  return true;
});

ipcMain.handle('minimize-window', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.handle('close-window', async () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
});

ipcMain.handle('save-history', async (event, items) => {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(items, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('保存历史记录失败：', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-history', async () => {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    if (!data.trim()) return [];
    const items = JSON.parse(data);
    return Array.isArray(items) ? items : [];
  } catch (error) {
    console.error('读取历史记录失败：', error);
    return [];
  }
});

ipcMain.handle('get-theme', async () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// --- 设置窗口 IPC ---

ipcMain.handle('load-settings', async () => {
  return loadSettings();
});

ipcMain.handle('save-settings', async (event, settings) => {
  saveSettings(settings);
  // 如果快捷键变了，立即重新注册
  if (settings.shortcut && settings.shortcut !== currentShortcut) {
    registerShortcut(settings.shortcut);
    // 同时更新持久化
  }
  return true;
});

ipcMain.handle('close-settings-window', async () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

// --------------------------------------------------
// 主题变化通知
// --------------------------------------------------
nativeTheme.on('updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('theme-changed', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
  }
});

// ============================================================
//  应用生命周期
// ============================================================

app.whenReady().then(() => {
  // 开机自启
  app.setLoginItemSettings({ openAtLogin: true });

  // 生成应用图标（供打包用）
  generateAppIcon();

  // 从设置文件读取快捷键并注册
  const settings = loadSettings();
  registerShortcut(settings.shortcut);

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) { tray.destroy(); tray = null; }
});

app.on('window-all-closed', () => {
  // 不退出，后台托盘运行
});
