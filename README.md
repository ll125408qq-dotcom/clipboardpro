# 📋 win新剪贴板

[![Windows](https://img.shields.io/badge/platform-Windows%2011-0078D6?logo=windows11)](https://github.com)
[![Electron](https://img.shields.io/badge/built%20with-Electron%2039-47848F?logo=electron)](https://www.electronjs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> **Windows 11 原生风格的增强型剪贴板管理器** — 彻底替代系统自带剪贴板，支持收藏分类、数据持久化与全局快捷键。

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| 🔥 **全局快捷键** | `Ctrl + Shift + V` 一键唤出，支持自定义快捷键 |
| 💾 **数据持久化** | 所有复制记录保存到本地 JSON，重启电脑不丢失 |
| ⭐ **收藏夹系统** | 星标收藏重要条目，支持多文件夹分类管理 |
| 📁 **文件夹分组** | 自定义文件夹（工作、学习、日常），按类整理收藏 |
| 🕐 **可视化时间线** | 左侧年月 → 日时层级时间线，点击节点快速定位 |
| 🔍 **实时搜索** | 关键词动态过滤，秒找历史记录 |
| 🎨 **Win11 毛玻璃** | 亚克力/云母半透明效果，自动跟随系统深浅主题 |
| 📌 **系统托盘驻留** | 关闭窗口即隐藏到托盘，后台静默运行不打扰 |
| 🚀 **开机自启** | 安装后随 Windows 自动启动，随时待命 |
| 🗑️ **干净卸载** | 从 Windows 设置 → 应用中一键卸载，无残留 |

## 📸 界面预览

```
┌──── 收藏夹 ────┐  ┌──────────── 主界面 ──────────────┐
│ 📋 全部内容 32  │  │  🔍 搜索复制内容...                │
│ ⭐ 全部收藏  8  │  │ ┌──────────────────────────────┐  │
│ 📁 工作      5  │  │ │ 复制的文本内容...              │  │
│ 📁 日常      2  │  │ │ 2026-07-21 14:30:05           │  │
│ 📁 学习      1  │  │ │ ⭐ 📋 🗑️                      │  │
│ ──── 分割线 ── │  │ └──────────────────────────────┘  │
│ ● 2026年07月  │  │ ┌──────────────────────────────┐  │
│ ├ ○ 21日 14时 │  │ │ 上一条复制内容...              │  │
│ ├ ○ 21日 10时 │  │ │ 2026-07-21 10:15:22           │  │
│ ● 2026年06月  │  │ │ ⭐ 📋 🗑️                      │  │
└────────────────┘  └────────────────────────────────────┘
```

## 📥 下载与安装

### 方式一：安装程序（推荐）

前往 [Releases](https://github.com/ll125408qq-dotcom/clipboardpro/releases) 页面，下载最新的 `win新剪贴板 Setup x.x.x.exe`：

1. 双击运行安装程序
2. 选择安装路径（或使用默认路径）
3. 安装完成后，桌面上会生成快捷方式
4. 双击 `win新剪贴板` 图标即可启动

### 卸载

打开 **Windows 设置 → 应用 → 已安装的应用** → 找到 `win新剪贴板` → 点击卸载，干净无残留。

### 方式二：开发者运行

```bash
# 克隆仓库
git clone https://github.com/ll125408qq-dotcom/clipboardpro.git
cd clipboardpro

# 安装依赖
npm install

# 启动应用
npm start

# 打包安装程序
npm run build
```

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl + Shift + V` | 唤出/隐藏窗口 |
| 自定义 | 托盘右键 → 设置 → 录制新快捷键 |

## 🏗️ 技术栈

- **框架**: Electron 39
- **界面**: HTML5 + CSS3 + Vanilla JavaScript
- **持久化**: Node.js 原生 `fs` 模块
- **打包**: electron-builder + NSIS
- **风格**: Windows 11 Fluent Design（毛玻璃 + 亚克力效果）

## 📁 项目结构

```
win新剪贴板/
├── main.js              # Electron 主进程（剪贴板监控、快捷键、IPC）
├── preload.js           # 安全桥接预加载脚本
├── index.html           # 主界面（收藏夹 + 时间线 + 历史列表）
├── style.css            # Win11 风格样式（深色/浅色双主题）
├── renderer.js          # 渲染进程逻辑（收藏夹、时间线、搜索、过滤）
├── settings.html        # 设置窗口界面
├── settings-preload.js  # 设置窗口预加载
├── settings-renderer.js # 设置窗口逻辑
└── package.json         # 项目配置（含 electron-builder NSIS 配置）
```

## 📄 许可

MIT License © 2026
