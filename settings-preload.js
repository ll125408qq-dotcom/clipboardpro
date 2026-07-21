/**
 * settings-preload.js —— 设置窗口的预加载脚本
 * 只暴露设置窗口需要的 IPC，与主窗口 preload 隔离
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  /** 读取当前设置 */
  loadSettings: () => ipcRenderer.invoke('load-settings'),

  /** 保存设置 */
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  /** 关闭设置窗口 */
  closeWindow: () => ipcRenderer.invoke('close-settings-window')
});
