/**
 * settings-renderer.js —— 设置窗口逻辑
 * 核心功能：录制全局快捷键、保存/取消
 */

const shortcutDisplay = document.getElementById('shortcutDisplay');
const recordBtn = document.getElementById('recordBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const closeBtn = document.getElementById('closeBtn');
const statusHint = document.getElementById('statusHint');

let currentShortcut = '';
let newShortcut = '';
let isRecording = false;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  const settings = await window.settingsAPI.loadSettings();
  currentShortcut = settings.shortcut || 'CommandOrControl+Alt+V';
  newShortcut = currentShortcut;
  shortcutDisplay.textContent = formatDisplay(currentShortcut);
});

// 关闭按钮
closeBtn.addEventListener('click', () => window.settingsAPI.closeWindow());
cancelBtn.addEventListener('click', () => window.settingsAPI.closeWindow());

// 录制按钮
recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
    return;
  }
  startRecording();
});

// 保存按钮
saveBtn.addEventListener('click', async () => {
  if (newShortcut) {
    await window.settingsAPI.saveSettings({ shortcut: newShortcut });
  }
  window.settingsAPI.closeWindow();
});

/**
 * 开始录制快捷键
 */
function startRecording() {
  isRecording = true;
  recordBtn.textContent = '⏺ 正在录制... 请按下组合键';
  recordBtn.classList.add('recording');
  shortcutDisplay.classList.add('recording');
  shortcutDisplay.textContent = '...';
  statusHint.textContent = '按 Esc 取消录制';

  document.addEventListener('keydown', onKeyDown);
}

/**
 * 停止录制
 */
function stopRecording() {
  isRecording = false;
  recordBtn.textContent = '🎹 录制快捷键';
  recordBtn.classList.remove('recording');
  shortcutDisplay.classList.remove('recording');
  statusHint.textContent = '点击下方按钮录制新的快捷键组合';
  document.removeEventListener('keydown', onKeyDown);
}

/**
 * 按键捕获处理
 */
function onKeyDown(event) {
  event.preventDefault();
  event.stopPropagation();

  // Esc 取消录制
  if (event.key === 'Escape') {
    newShortcut = currentShortcut;
    shortcutDisplay.textContent = formatDisplay(currentShortcut);
    stopRecording();
    return;
  }

  // 忽略纯修饰键（没有主键时）
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta', 'OS'];
  if (modifiers.includes(event.key)) return;

  // 构建 accelerator 字符串
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  // 主键
  let mainKey = event.key;
  if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
  // 特殊键标准化
  const keyMap = { ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
    'ArrowLeft': 'Left', 'ArrowRight': 'Right' };
  if (keyMap[mainKey]) mainKey = keyMap[mainKey];

  parts.push(mainKey);
  newShortcut = parts.join('+');

  shortcutDisplay.textContent = formatDisplay(newShortcut);
  statusHint.textContent = '新快捷键已录制，点击保存生效';
  stopRecording();
}

/**
 * 将 accelerator 格式化显示
 * e.g. "CommandOrControl+Alt+V" → "Ctrl + Alt + V"
 */
function formatDisplay(accel) {
  return accel
    .replace(/CommandOrControl/g, 'Ctrl')
    .replace(/Control/g, 'Ctrl')
    .replace(/Command/g, '⌘')
    .replace(/\+/g, ' + ');
}
