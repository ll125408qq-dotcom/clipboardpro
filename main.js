/**
 * ============================================================
 * main.js —— Electron 的【主进程】入口文件
 * ============================================================
 *
 * 关键设计：
 *   1. 点 × 关闭 → 隐藏到系统托盘，后台静默运行，不退出进程
 *   2. 右键托盘图标 →「退出 ClipboardPro」才能真正退出
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
  shortcut: 'CommandOrControl+Shift+V'
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
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (e) { console.error('保存设置失败：', e); }
}

// --------------------------------------------------
// 程序化生成托盘图标
// --------------------------------------------------
function createTrayIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4, 0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - 7.5, dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 6) {
        const alpha = dist > 5 ? 150 : 255;
        buf[idx] = 0; buf[idx + 1] = 103;
        buf[idx + 2] = 192; buf[idx + 3] = alpha;
      }
    }
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// --------------------------------------------------
// 创建应用图标（用于打包和快捷方式）
//   生成一个 256×256 的 PNG，然后保存为 .ico 兼容格式
//   实际上 electron-builder 可以从 PNG 自动转换，
//   这里生成一个简单 PNG 放在 assets/
// --------------------------------------------------
function generateAppIcon() {
  const assetsDir = path.join(__dirname, 'assets');
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const iconPath = path.join(assetsDir, 'icon.png');
  if (fs.existsSync(iconPath)) return; // 已存在则跳过

  const size = 256;
  const buf = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2, cy = size / 2, r = size * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < r) {
        const alpha = dist > r - 3 ? 200 : 255;
        buf[idx] = 0; buf[idx + 1] = 103;
        buf[idx + 2] = 192; buf[idx + 3] = alpha;
      }
    }
  }

  // 写为简单 BMP 头 + 像素数据（临时方案，方便 electron-builder 识别）
  // 实际上用 PNG 更标准，这里写一个最小 BMP
  const fileSize = 54 + buf.length;
  const header = Buffer.alloc(54);
  header.write('BM', 0);                    // 签名
  header.writeUInt32LE(fileSize, 2);        // 文件大小
  header.writeUInt32LE(54, 10);             // 像素偏移
  header.writeUInt32LE(40, 14);             // DIB 头大小
  header.writeInt32LE(size, 18);            // 宽
  header.writeInt32LE(-size, 22);           // 高（负值 = 从上到下）
  header.writeUInt16LE(1, 26);              // 颜色平面
  header.writeUInt16LE(32, 28);             // 位深度
  header.writeUInt32LE(0, 30);              // 压缩
  header.writeUInt32LE(buf.length, 34);     // 图像大小

  fs.writeFileSync(iconPath, Buffer.concat([header, buf]));
  console.log('【图标】已生成 assets/icon.png');

  // 同时生成 .ico 文件（electron-builder 在 Windows 上需要 .ico）
  // 简单方案：复制 BMP 为 .ico（electron-builder 可以接受 PNG 自动转 ico）
  const pngHeader = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A  // PNG signature
  ]);
  // 这里用最简单的 BMP -> ico 包装方式
  const icoPath = path.join(assetsDir, 'icon.ico');
  if (!fs.existsSync(icoPath)) {
    // 只写 BMP 头部分作为占位，让 electron-builder 用 png 生成真正的 ico
    fs.copyFileSync(iconPath, icoPath);
    console.log('【图标】已生成 assets/icon.ico');
  }
}

// --------------------------------------------------
// 创建系统托盘
// --------------------------------------------------
function createTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('ClipboardPro - 增强型剪贴板管理器');
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
      label: '退出 ClipboardPro',
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false   // 关键：隐藏时不节流，避免 show 时白闪
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    startClipboardWatcher();
  });

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
