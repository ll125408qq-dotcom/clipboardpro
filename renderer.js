/**
 * ============================================================
 * renderer.js —— Electron 的【渲染进程】逻辑
 * ============================================================
 */
"use strict";

// --------------------------------------------------
// 全局状态
// --------------------------------------------------
let historyItems = [];
let filteredItems = [];
let lastClipboardText = '';
let currentSearch = '';
let currentTimeFilter = null;
let expandedMonth = null;
let folders = ['默认'];               // 文件夹列表
let currentFolder = null;             // 当前选中的文件夹 null=全部

const MAX_HISTORY = 5000;

// 弹窗模式
let modalMode = '';   // 'newFolder' | 'renameFolder'
let modalFolderTarget = '';

// --------------------------------------------------
// DOM 元素引用
// --------------------------------------------------
const folderListEl = document.getElementById('folderList');
const newFolderBtn = document.getElementById('newFolderBtn');
const timelineNodesEl = document.getElementById('timelineNodes');
const timelineEmptyEl = document.getElementById('timelineEmpty');
const timelineAllBtn = document.getElementById('timelineAllBtn');
const historyListEl = document.getElementById('historyList');
const emptyStateEl = document.getElementById('emptyState');
const searchInputEl = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const minimizeBtn = document.getElementById('minimizeBtn');
const closeBtn = document.getElementById('closeBtn');
const toastEl = document.getElementById('toast');
// 弹窗
const modal = document.getElementById('folderModal');
const modalTitle = document.getElementById('modalTitle');
const modalInput = document.getElementById('modalInput');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');

// --------------------------------------------------
// 初始化
// --------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadHistory();

  if (window.electronAPI.onNewClipboardItem) {
    window.electronAPI.onNewClipboardItem((newItem) => {
      handleNewClipboardItem(newItem);
    });
  }

  bindEvents();
  renderFolders();
  applySearch();

  if (window.electronAPI.onThemeChange) {
    window.electronAPI.onThemeChange((theme) => {
      console.log('系统主题切换为：', theme);
    });
  }
});

// --------------------------------------------------
// 设置持久化
// --------------------------------------------------
async function loadSettings() {
  try {
    const settings = await window.electronAPI.loadSettings();
    if (settings && settings.folders && Array.isArray(settings.folders)) {
      folders = settings.folders;
    }
  } catch (e) {
    console.error('加载设置失败：', e);
  }
}

async function saveSettings() {
  try {
    await window.electronAPI.saveSettings({ folders });
  } catch (e) {
    console.error('保存设置失败：', e);
  }
}

// --------------------------------------------------
// 处理剪贴板新内容
// --------------------------------------------------
async function handleNewClipboardItem(newItem) {
  try {
    if (!newItem.text || newItem.text === lastClipboardText) return;
    lastClipboardText = newItem.text;
    const latest = historyItems[0];
    if (latest && latest.text === newItem.text) return;

    newItem.favorite = false;
    newItem.folder = '';
    historyItems.unshift(newItem);
    if (historyItems.length > MAX_HISTORY) {
      historyItems = historyItems.slice(0, MAX_HISTORY);
    }
    await saveHistory();
    renderTimeline();
    applySearch();
  } catch (error) {
    console.error('处理剪贴板内容出错：', error);
  }
}

// --------------------------------------------------
// 加载 / 保存历史记录
// --------------------------------------------------
async function loadHistory() {
  try {
    historyItems = await window.electronAPI.loadHistory();
    if (!Array.isArray(historyItems)) historyItems = [];
    historyItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    // 初始化老数据的收藏字段
    historyItems.forEach(i => { if (i.favorite === undefined) i.favorite = false; if (i.folder === undefined) i.folder = ''; });
    if (historyItems.length > 0) lastClipboardText = historyItems[0].text;
    renderTimeline();
    applySearch();
  } catch (error) {
    console.error('加载历史记录失败：', error);
    historyItems = [];
  }
}

async function saveHistory() {
  try { await window.electronAPI.saveHistory(historyItems); }
  catch (error) { console.error('保存历史记录失败：', error); }
}

// ============================================================
//  收藏夹 / 文件夹管理
// ============================================================

function renderFolders() {
  folderListEl.innerHTML = '';

  // "全部"行
  const allItem = document.createElement('li');
  allItem.className = 'folder-item' + (currentFolder === null ? ' active' : '');
  allItem.innerHTML = `<span class="folder-icon">📋</span><span class="folder-name">全部</span>`;
  allItem.addEventListener('click', () => selectFolder(null));
  folderListEl.appendChild(allItem);

  folders.forEach(folder => {
    const count = historyItems.filter(i => i.folder === folder).length;
    const li = document.createElement('li');
    li.className = 'folder-item' + (currentFolder === folder ? ' active' : '');
    li.innerHTML = `
      <span class="folder-icon">📁</span>
      <span class="folder-name">${escapeHtml(folder)}</span>
      <span class="folder-count">${count}</span>
      <button class="folder-ctx" data-folder="${escapeHtml(folder)}">⋯</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.folder-ctx')) return;
      selectFolder(folder);
    });
    const ctxBtn = li.querySelector('.folder-ctx');
    ctxBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showFolderContextMenu(folder, ctxBtn);
    });
    folderListEl.appendChild(li);
  });
}

function selectFolder(folder) {
  currentFolder = folder;
  renderFolders();
  applySearch();
}

function showFolderContextMenu(folder, anchor) {
  // 简单的浏览器原生 confirm 替代右键菜单
  // 用弹窗实现：询问操作
  const action = prompt(`文件夹「${folder}」操作：\n- 输入新名称重命名\n- 输入 DELETE 删除\n- 取消不做任何操作`);
  if (action === null) return;
  if (action === 'DELETE') {
    deleteFolder(folder);
  } else if (action.trim()) {
    renameFolder(folder, action.trim());
  }
}

function deleteFolder(folder) {
  if (folder === '默认') {
    showToast('不能删除默认文件夹');
    return;
  }
  // 该文件夹下的条目取消收藏
  historyItems.forEach(i => {
    if (i.folder === folder) { i.favorite = false; i.folder = ''; }
  });
  const idx = folders.indexOf(folder);
  if (idx > -1) folders.splice(idx, 1);
  if (currentFolder === folder) currentFolder = null;
  saveSettings();
  saveHistory();
  renderFolders();
  applySearch();
  showToast(`已删除「${folder}」`);
}

function renameFolder(oldName, newName) {
  if (!newName) return;
  if (folders.includes(newName) && newName !== oldName) {
    showToast('文件夹名称已存在');
    return;
  }
  const idx = folders.indexOf(oldName);
  if (idx === -1) return;
  folders[idx] = newName;
  // 更新条目
  historyItems.forEach(i => { if (i.folder === oldName) i.folder = newName; });
  if (currentFolder === oldName) currentFolder = newName;
  saveSettings();
  saveHistory();
  renderFolders();
  applySearch();
  showToast(`已重命名为「${newName}」`);
}

function createFolder(name) {
  if (!name) return;
  if (folders.includes(name)) {
    showToast('文件夹已存在');
    return;
  }
  folders.push(name);
  saveSettings();
  renderFolders();
  showToast(`已创建「${name}」`);
}

// ============================================================
//  收藏操作（星标）
// ============================================================

function toggleFavorite(id) {
  const item = historyItems.find(i => i.id === id);
  if (!item) return;

  if (item.favorite) {
    // 取消收藏
    item.favorite = false;
    item.folder = '';
  } else {
    // 收藏到"默认"文件夹
    item.favorite = true;
    item.folder = '默认';
  }
  saveHistory();
  renderFolders();
  applySearch();
}

// ============================================================
//  时间线
// ============================================================

function buildTimelineData() {
  const groups = new Map();
  for (const item of historyItems) {
    const d = new Date(item.createdAt);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dh = `${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}时`;

    if (!groups.has(ym)) {
      groups.set(ym, { yearMonth: ym, label: formatYearMonth(ym), items: [], subMap: new Map() });
    }
    const g = groups.get(ym);
    g.items.push(item);
    if (!g.subMap.has(dh)) g.subMap.set(dh, []);
    g.subMap.get(dh).push(item);
  }

  const result = Array.from(groups.values()).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  for (const g of result) {
    g.subGroups = Array.from(g.subMap.entries())
      .map(([dh, items]) => ({ dayHour: dh, label: dh, items }))
      .sort((a, b) => b.dayHour.localeCompare(a.dayHour));
    delete g.subMap;
  }
  return result;
}

function formatYearMonth(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${m}月`;
}

function renderTimeline() {
  const data = buildTimelineData();
  if (data.length === 0) {
    timelineNodesEl.style.display = 'none';
    timelineEmptyEl.style.display = 'flex';
    return;
  }
  timelineNodesEl.style.display = 'block';
  timelineEmptyEl.style.display = 'none';
  timelineNodesEl.innerHTML = '';

  data.forEach((group) => {
    const bigNode = document.createElement('div');
    bigNode.className = 'timeline-big-node' + (expandedMonth === group.yearMonth ? ' expanded' : '');
    bigNode.innerHTML = `
      <div class="timeline-big-dot"></div>
      <span class="timeline-big-label">${group.label}</span>
      <span class="timeline-big-count">${group.items.length}条</span>
      <span class="timeline-big-arrow">▶</span>
    `;
    bigNode.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(group); });
    timelineNodesEl.appendChild(bigNode);

    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'timeline-children' + (expandedMonth === group.yearMonth ? ' open' : '');
    group.subGroups.forEach((sub) => {
      const smallNode = document.createElement('div');
      smallNode.className = 'timeline-small-node' +
        (currentTimeFilter && currentTimeFilter.yearMonth === group.yearMonth && currentTimeFilter.dayHour === sub.dayHour ? ' active' : '');
      smallNode.innerHTML = `
        <div class="timeline-small-dot"></div>
        <span class="timeline-small-label">${sub.dayHour}</span>
        <span class="timeline-small-count">${sub.items.length}条</span>
      `;
      smallNode.addEventListener('click', (e) => { e.stopPropagation(); selectTimeNode(group.yearMonth, sub.dayHour); });
      childrenWrap.appendChild(smallNode);
    });
    timelineNodesEl.appendChild(childrenWrap);
  });
}

function toggleExpand(group) {
  if (expandedMonth === group.yearMonth) {
    expandedMonth = null;
    if (currentTimeFilter && currentTimeFilter.yearMonth === group.yearMonth) clearTimeFilter();
  } else {
    expandedMonth = group.yearMonth;
    if (currentTimeFilter && currentTimeFilter.yearMonth !== group.yearMonth) clearTimeFilter();
  }
  renderTimeline();
  applySearch();
}

function selectTimeNode(yearMonth, dayHour) {
  currentTimeFilter = { yearMonth, dayHour };
  updateTimelineAllBtn();
  renderTimeline();
  applySearch();
}

function clearTimeFilter() {
  currentTimeFilter = null;
  updateTimelineAllBtn();
  renderTimeline();
  applySearch();
}

function updateTimelineAllBtn() {
  timelineAllBtn.classList.toggle('active', !currentTimeFilter);
}

// ============================================================
//  搜索 + 时间过滤 + 文件夹过滤 + 列表渲染
// ============================================================

function applySearch() {
  // 第一步：时间过滤
  let base = [...historyItems];
  if (currentTimeFilter) {
    base = base.filter(item => {
      const d = new Date(item.createdAt);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dh = `${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}时`;
      return ym === currentTimeFilter.yearMonth && dh === currentTimeFilter.dayHour;
    });
  }

  // 第二步：文件夹过滤
  if (currentFolder !== null) {
    base = base.filter(item => item.folder === currentFolder);
  }

  // 第三步：关键词搜索
  const keyword = currentSearch.toLowerCase();
  filteredItems = keyword ? base.filter(item => item.text.toLowerCase().includes(keyword)) : base;

  renderList();
}

function renderList() {
  historyListEl.innerHTML = '';
  if (filteredItems.length === 0) {
    emptyStateEl.classList.add('visible');
    historyListEl.style.display = 'none';
    return;
  }
  emptyStateEl.classList.remove('visible');
  historyListEl.style.display = 'block';

  filteredItems.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.title = item.text;
    li.dataset.id = item.id;

    const starClass = item.favorite ? 'action-btn fav active' : 'action-btn fav';
    const starChar = item.favorite ? '⭐' : '☆';

    li.innerHTML = `
      <div class="history-content">
        <div class="history-text">${escapeHtml(item.text)}</div>
        <div class="history-time">${formatTime(item.createdAt)}</div>
      </div>
      <div class="history-actions">
        <button class="${starClass}" title="收藏">${starChar}</button>
        <button class="action-btn copy" title="复制到剪贴板">📋</button>
        <button class="action-btn delete" title="删除">🗑️</button>
      </div>
    `;

    li.querySelector('.fav').addEventListener('click', (e) => { e.stopPropagation(); toggleFavorite(item.id); });
    li.querySelector('.copy').addEventListener('click', (e) => { e.stopPropagation(); copyItem(item.id); });
    li.querySelector('.delete').addEventListener('click', (e) => { e.stopPropagation(); deleteItem(item.id); });
    li.addEventListener('click', (e) => { if (!e.target.closest('.action-btn')) copyItem(item.id); });

    historyListEl.appendChild(li);
  });
}

// ============================================================
//  操作
// ============================================================

async function copyItem(id) {
  const item = historyItems.find(i => i.id === id);
  if (!item) return;
  try {
    window.electronAPI.writeClipboard(item.text);
    lastClipboardText = item.text;
    showToast('已复制');
  } catch (error) { showToast('复制失败'); }
}

async function deleteItem(id) {
  const idx = historyItems.findIndex(i => i.id === id);
  if (idx === -1) return;
  historyItems.splice(idx, 1);
  await saveHistory();
  renderTimeline();
  renderFolders();
  applySearch();
}

// ============================================================
//  弹窗（新建/重命名文件夹）
// ============================================================

function openModal(mode, folderName) {
  modalMode = mode;
  modalFolderTarget = folderName || '';
  modal.style.display = 'flex';
  modalInput.value = folderName || '';
  modalInput.focus();
  if (mode === 'renameFolder') {
    modalTitle.textContent = '重命名文件夹';
    modalInput.placeholder = '输入新名称';
  } else {
    modalTitle.textContent = '新建文件夹';
    modalInput.placeholder = '输入文件夹名称';
  }
}

function closeModal() {
  modal.style.display = 'none';
  modalMode = '';
  modalFolderTarget = '';
  modalInput.value = '';
}

// ============================================================
//  事件绑定
// ============================================================

function bindEvents() {
  // 新建文件夹
  newFolderBtn.addEventListener('click', () => openModal('newFolder'));

  // 弹窗确认
  modalConfirmBtn.addEventListener('click', () => {
    const name = modalInput.value.trim();
    if (!name) return;
    if (modalMode === 'newFolder') createFolder(name);
    else if (modalMode === 'renameFolder') renameFolder(modalFolderTarget, name);
    closeModal();
  });
  modalCancelBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalConfirmBtn.click(); if (e.key === 'Escape') closeModal(); });

  // 时间线全部
  timelineAllBtn.addEventListener('click', clearTimeFilter);

  // 搜索
  searchInputEl.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim();
    updateClearSearchButton();
    applySearch();
  });
  clearSearchBtn.addEventListener('click', () => {
    searchInputEl.value = '';
    currentSearch = '';
    updateClearSearchButton();
    applySearch();
    searchInputEl.focus();
  });

  // 窗口控制
  minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow && window.electronAPI.minimizeWindow());
  closeBtn.addEventListener('click', () => window.electronAPI.closeWindow && window.electronAPI.closeWindow());
}

function updateClearSearchButton() {
  const box = searchInputEl.parentElement;
  box.classList.toggle('has-value', !!currentSearch);
}

// ============================================================
//  工具函数
// ============================================================

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  if (showToast._timeout) clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => toastEl.classList.remove('show'), 1500);
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function escapeHtml(t) {
  const div = document.createElement('div');
  div.textContent = t;
  return div.innerHTML;
}
