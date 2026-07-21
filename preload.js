/**
 * ============================================================
 * preload.js —— 预加载脚本（安全桥接主进程与渲染进程）
 * ============================================================
 *
 * 为什么需要 preload.js？
 *   在 Electron 中，为了安全，渲染进程默认不能直接调用 Node.js 模块
 *   或使用 ipcRenderer。如果直接暴露 ipcRenderer，渲染进程里的
 *   任何代码（包括第三方脚本）都能随意发送任意 IPC 消息，存在风险。
 *
 *   preload.js 在窗口加载前执行，它通过 contextBridge 有选择性地
 *   把"渲染进程真正需要的能力"挂载到 window.electronAPI 上。
 *   这样渲染进程只能使用我们暴露的这几个函数，无法做其他危险操作。
 *
 * 本文件暴露的 API：
 *   - loadHistory()              读取本地历史记录
 *   - saveHistory(items)         保存历史记录到本地文件
 *   - getTheme()                 获取当前系统主题
 *   - onThemeChange(cb)          监听系统主题变化
 *   - onNewClipboardItem(cb)     监听主进程推送的新剪贴板内容
 *   - writeClipboard(text)       写入文本到系统剪贴板
 *   - minimizeWindow()           最小化窗口
 *   - closeWindow()              关闭窗口
 * ============================================================
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 读取本地保存的剪贴板历史记录
   * @returns {Promise<Array>} 历史记录数组
   */
  loadHistory: () => ipcRenderer.invoke('load-history'),

  /**
   * 保存剪贴板历史记录到本地 JSON 文件
   * @param {Array} items 历史记录数组
   * @returns {Promise<Object>} { success: boolean, error?: string }
   */
  saveHistory: (items) => ipcRenderer.invoke('save-history', items),

  /**
   * 获取当前系统主题：'light' 或 'dark'
   * @returns {Promise<string>}
   */
  getTheme: () => ipcRenderer.invoke('get-theme'),

  /**
   * 监听系统主题变化
   * @param {Function} callback 回调函数，接收 'light' 或 'dark'
   */
  onThemeChange: (callback) => {
    // 先移除可能已存在的同名监听器，避免重复注册
    ipcRenderer.removeAllListeners('theme-changed');
    ipcRenderer.on('theme-changed', (event, theme) => {
      callback(theme);
    });
  },

  /**
   * 监听主进程推送的新剪贴板内容
   * 剪贴板监控已移到主进程（main.js），主进程检测到新内容后
   * 通过此通道推送给渲染进程，渲染进程负责保存和显示
   * @param {Function} callback 回调函数，接收 { id, text, createdAt }
   */
  onNewClipboardItem: (callback) => {
    ipcRenderer.removeAllListeners('new-clipboard-item');
    ipcRenderer.on('new-clipboard-item', (event, item) => {
      callback(item);
    });
  },

  /**
   * 最小化主窗口
   */
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),

  /**
   * 关闭主窗口
   */
  closeWindow: () => ipcRenderer.invoke('close-window'),

  /**
   * 将文本写入系统剪贴板
   * @param {string} text 要写入的文本
   */
  /**
   * 将文本写入系统剪贴板
   * 通过 IPC 交由主进程执行，避免 contextBridge 安全限制导致写入失败
   * @param {string} text 要写入的文本
   */
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text)
});
