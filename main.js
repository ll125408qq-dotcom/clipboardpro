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
const iconGen = require('./icon-gen');

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

// 图标生成委托给 icon-gen 模块（真实 PNG 编码，修复 RGBA→BGRA 通道错乱）
// --------------------------------------------------
// 创建系统托盘
// --------------------------------------------------
function createTray() {
  const icon = iconGen.createTrayIcon(nativeImage);
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
  iconGen.generateAppIcon(__dirname);

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
