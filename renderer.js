/**
 * renderer.js —— 渲染进程逻辑
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
let folders = ['默认'];
let currentFolder = null;           // null = 显示全部（时间线未选文件夹也无过滤）
let isFavFilter = false;           // true = 收藏夹"全部"视图

const MAX_HISTORY = 5000;

// --------------------------------------------------
// DOM 引用
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
// 右键菜单
const ctxMenu = document.getElementById('ctxMenu');
// 文件夹弹窗
const folderModal = document.getElementById('folderModal');
const modalTitle = document.getElementById('modalTitle');
const modalInput = document.getElementById('modalInput');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
// 收藏选择器
const favPickerModal = document.getElementById('favPickerModal');
const favPickerList = document.getElementById('favPickerList');
const favPickerNewBtn = document.getElementById('favPickerNewBtn');
const favPickerCancelBtn = document.getElementById('favPickerCancelBtn');

let ctxTargetFolder = '';           // 右键菜单目标文件夹
let renameTarget = null;            // 重命名目标，null=新建模式，有值=重命名模式
let favTargetItemId = null;         // 正在收藏的 item id

// --------------------------------------------------
// 初始化
// --------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await loadHistory();

  if (window.electronAPI.onNewClipboardItem) {
    window.electronAPI.onNewClipboardItem((item) => handleNewClipboardItem(item));
  }

  bindEvents();
  renderFolders();
  applySearch();
});

// --------------------------------------------------
// 设置
// --------------------------------------------------
async function loadSettings() {
  try {
    const s = await window.electronAPI.loadSettings();
    if (s && s.folders && Array.isArray(s.folders)) folders = s.folders;
  } catch (e) { console.error('加载设置失败', e); }
}
async function saveSettings() {
  try { await window.electronAPI.saveSettings({ folders }); }
  catch (e) { console.error('保存设置失败', e); }
}

// --------------------------------------------------
// 历史记录
// --------------------------------------------------
async function handleNewClipboardItem(item) {
  if (!item.text || item.text === lastClipboardText) return;
  lastClipboardText = item.text;
  const latest = historyItems[0];
  if (latest && latest.text === item.text) return;
  item.favorite = false; item.folder = '';
  historyItems.unshift(item);
  if (historyItems.length > MAX_HISTORY) historyItems = historyItems.slice(0, MAX_HISTORY);
  await saveHistory();
  renderTimeline();
  applySearch();
}

async function loadHistory() {
  try {
    historyItems = await window.electronAPI.loadHistory();
    if (!Array.isArray(historyItems)) historyItems = [];
    historyItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    historyItems.forEach(i => { if (i.favorite === undefined) i.favorite = false; if (i.folder === undefined) i.folder = ''; });
    if (historyItems.length > 0) lastClipboardText = historyItems[0].text;
    renderTimeline();
    applySearch();
  } catch (e) { historyItems = []; }
}

async function saveHistory() {
  try { await window.electronAPI.saveHistory(historyItems); }
  catch (e) { console.error('保存历史失败', e); }
}

// ============================================================
//  收藏夹
// ============================================================

function renderFolders() {
  folderListEl.innerHTML = '';

  // 全部内容 —— 清空所有过滤，显示全部记录
  const allItems = document.createElement('li');
  allItems.className = 'folder-item' + (currentFolder === null && !isFavFilter && !currentTimeFilter ? ' active' : '');
  allItems.innerHTML = `<span class="folder-icon">📋</span><span class="folder-name">全部内容</span><span class="folder-count">${historyItems.length}</span>`;
  allItems.addEventListener('click', () => { selectAllItems(); });
  folderListEl.appendChild(allItems);

  // 全部收藏 —— 过滤所有 favorite === true
  const allFav = document.createElement('li');
  allFav.className = 'folder-item' + (currentFolder === null && isFavFilter ? ' active' : '');
  allFav.innerHTML = `<span class="folder-icon">⭐</span><span class="folder-name">全部收藏</span><span class="folder-count">${historyItems.filter(i => i.favorite).length}</span>`;
  allFav.addEventListener('click', () => { selectFavAll(); });
  folderListEl.appendChild(allFav);

  folders.forEach(f => {
    const count = historyItems.filter(i => i.folder === f).length;
    const li = document.createElement('li');
    li.className = 'folder-item' + (currentFolder === f ? ' active' : '');
    li.innerHTML = `📁<span class="folder-name">${escapeHtml(f)}</span><span class="folder-count">${count}</span><button class="folder-ctx" data-folder="${escapeHtml(f)}">⋯</button>`;
    li.addEventListener('click', (e) => { if (!e.target.closest('.folder-ctx')) selectFolder(f); });
    li.querySelector('.folder-ctx').addEventListener('click', (e) => { e.stopPropagation(); showCtxMenu(f, e.clientX, e.clientY); });
    folderListEl.appendChild(li);
  });
}

function selectFavAll() {
  currentFolder = null;
  isFavFilter = true;
  currentTimeFilter = null; expandedMonth = null; updateTimelineAllBtn();
  renderFolders();
  renderTimeline();
  applySearch();
}

function selectAllItems() {
  currentFolder = null;
  isFavFilter = false;
  currentTimeFilter = null; expandedMonth = null; updateTimelineAllBtn();
  renderFolders();
  renderTimeline();
  applySearch();
}

function selectFolder(folder) {
  // 点击已选中的文件夹 → 取消选中，回到全部
  if (currentFolder === folder) {
    selectAllItems();
    return;
  }
  currentFolder = folder;
  isFavFilter = false;
  currentTimeFilter = null; expandedMonth = null; updateTimelineAllBtn();
  renderFolders();
  renderTimeline();
  applySearch();
}

function showCtxMenu(folder, x, y) {
  ctxTargetFolder = folder;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
}

// --------------------------------------------------
// 右键菜单操作
// --------------------------------------------------
document.addEventListener('click', (e) => {
  if (!e.target.closest('#ctxMenu')) ctxMenu.style.display = 'none';
});

ctxMenu.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  ctxMenu.style.display = 'none';
  if (!action || !ctxTargetFolder) return;
  if (action === 'rename') {
    renameTarget = ctxTargetFolder;
    modalTitle.textContent = '重命名文件夹';
    modalInput.value = ctxTargetFolder;
    modalInput.placeholder = '输入新名称';
    folderModal.style.display = 'flex';
    modalInput.focus();
  } else if (action === 'delete') {
    if (ctxTargetFolder === '默认') { showToast('不能删除默认文件夹'); return; }
    if (confirm(`确定删除「${ctxTargetFolder}」？其中的收藏将被取消。`)) deleteFolder(ctxTargetFolder);
  }
});

function deleteFolder(folder) {
  historyItems.forEach(i => { if (i.folder === folder) { i.favorite = false; i.folder = ''; } });
  const idx = folders.indexOf(folder);
  if (idx > -1) folders.splice(idx, 1);
  if (currentFolder === folder) { currentFolder = null; isFavFilter = false; }
  saveSettings(); saveHistory();
  renderFolders(); applySearch();
  showToast(`已删除「${folder}」`);
}

function renameFolder(old, n) {
  if (!n || n === old) return;
  if (folders.includes(n)) { showToast('名称已存在'); return; }
  const idx = folders.indexOf(old);
  if (idx === -1) return;
  folders[idx] = n;
  historyItems.forEach(i => { if (i.folder === old) i.folder = n; });
  if (currentFolder === old) currentFolder = n;
  saveSettings(); saveHistory();
  renderFolders(); applySearch();
  showToast(`已重命名为「${n}」`);
}

function createFolder(name) {
  if (!name) return;
  if (folders.includes(name)) { showToast('已存在'); return; }
  folders.push(name);
  saveSettings();
  renderFolders();
  showToast(`已创建「${name}」`);
}

// ============================================================
//  收藏操作
// ============================================================

function toggleFavorite(id) {
  const item = historyItems.find(i => i.id === id);
  if (!item) return;

  if (item.favorite) {
    // 取消收藏
    item.favorite = false;
    item.folder = '';
    saveHistory();
    renderFolders();
    applySearch();
    showToast('已取消收藏');
  } else {
    // 弹出文件夹选择器
    favTargetItemId = id;
    showFavPicker(item.text);
  }
}

function showFavPicker(text) {
  const list = favPickerList;
  list.innerHTML = '';
  folders.forEach(f => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="fp-icon">📁</span> ${escapeHtml(f)}`;
    li.addEventListener('click', () => {
      setFavorite(favTargetItemId, f);
      favPickerModal.style.display = 'none';
    });
    list.appendChild(li);
  });
  favPickerModal.style.display = 'flex';
}

favPickerCancelBtn.addEventListener('click', () => { favPickerModal.style.display = 'none'; favTargetItemId = null; });

favPickerNewBtn.addEventListener('click', () => {
  favPickerModal.style.display = 'none';
  folderModal._pendingFav = favTargetItemId;
  renameTarget = null;
  modalTitle.textContent = '新建文件夹';
  modalInput.value = '';
  modalInput.placeholder = '输入文件夹名称';
  folderModal.style.display = 'flex';
  modalInput.focus();
});

function setFavorite(id, folder) {
  const item = historyItems.find(i => i.id === id);
  if (!item) return;
  item.favorite = true;
  item.folder = folder;
  saveHistory();
  renderFolders();
  applySearch();
  showToast(`已收藏到「${folder}」`);
}

// ============================================================
//  时间线
// ============================================================

function buildTimelineData() {
  const groups = new Map();
  for (const item of historyItems) {
    const d = new Date(item.createdAt);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const dh = `${String(d.getDate()).padStart(2,'0')}日 ${String(d.getHours()).padStart(2,'0')}时`;
    if (!groups.has(ym)) groups.set(ym, { yearMonth: ym, label: formatYearMonth(ym), items: [], subMap: new Map() });
    const g = groups.get(ym); g.items.push(item);
    if (!g.subMap.has(dh)) g.subMap.set(dh, []);
    g.subMap.get(dh).push(item);
  }
  const r = Array.from(groups.values()).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  for (const g of r) {
    g.subGroups = Array.from(g.subMap.entries()).map(([dh, items]) => ({ dayHour: dh, label: dh, items })).sort((a, b) => b.dayHour.localeCompare(a.dayHour));
    delete g.subMap;
  }
  return r;
}
function formatYearMonth(ym) { const [y, m] = ym.split('-'); return `${y}年${m}月`; }

function renderTimeline() {
  const data = buildTimelineData();
  if (data.length === 0) { timelineNodesEl.style.display = 'none'; timelineEmptyEl.style.display = 'flex'; return; }
  timelineNodesEl.style.display = 'block'; timelineEmptyEl.style.display = 'none';
  timelineNodesEl.innerHTML = '';
  data.forEach(g => {
    const bn = document.createElement('div');
    bn.className = 'timeline-big-node' + (expandedMonth === g.yearMonth ? ' expanded' : '');
    bn.innerHTML = `<div class="timeline-big-dot"></div><span class="timeline-big-label">${g.label}</span><span class="timeline-big-count">${g.items.length}条</span><span class="timeline-big-arrow">▶</span>`;
    bn.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(g); });
    timelineNodesEl.appendChild(bn);
    const cw = document.createElement('div');
    cw.className = 'timeline-children' + (expandedMonth === g.yearMonth ? ' open' : '');
    g.subGroups.forEach(s => {
      const sn = document.createElement('div');
      sn.className = 'timeline-small-node' + (currentTimeFilter && currentTimeFilter.yearMonth === g.yearMonth && currentTimeFilter.dayHour === s.dayHour ? ' active' : '');
      sn.innerHTML = `<div class="timeline-small-dot"></div><span class="timeline-small-label">${s.dayHour}</span><span class="timeline-small-count">${s.items.length}条</span>`;
      sn.addEventListener('click', (e) => { e.stopPropagation(); selectTimeNode(g.yearMonth, s.dayHour); });
      cw.appendChild(sn);
    });
    timelineNodesEl.appendChild(cw);
  });
}
function toggleExpand(g) {
  if (expandedMonth === g.yearMonth) { expandedMonth = null; if (currentTimeFilter && currentTimeFilter.yearMonth === g.yearMonth) clearTimeFilter(); }
  else { expandedMonth = g.yearMonth; if (currentTimeFilter && currentTimeFilter.yearMonth !== g.yearMonth) clearTimeFilter(); }
  renderTimeline(); applySearch();
}
function selectTimeNode(ym, dh) { currentTimeFilter = { yearMonth: ym, dayHour: dh }; updateTimelineAllBtn(); renderTimeline(); applySearch(); }
function clearTimeFilter() { currentTimeFilter = null; updateTimelineAllBtn(); renderTimeline(); applySearch(); }
function updateTimelineAllBtn() { timelineAllBtn.classList.toggle('active', !currentTimeFilter && !isFavFilter && currentFolder === null); }

// ============================================================
//  搜索 + 过滤 + 渲染
// ============================================================

function applySearch() {
  let base = [...historyItems];
  // 时间过滤
  if (currentTimeFilter) {
    base = base.filter(i => {
      const d = new Date(i.createdAt);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const dh = `${String(d.getDate()).padStart(2,'0')}日 ${String(d.getHours()).padStart(2,'0')}时`;
      return ym === currentTimeFilter.yearMonth && dh === currentTimeFilter.dayHour;
    });
  }
  // 收藏夹过滤
  if (isFavFilter) {
    base = base.filter(i => i.favorite === true);
  }
  if (currentFolder !== null) {
    base = base.filter(i => i.folder === currentFolder);
  }
  // 搜索
  const kw = currentSearch.toLowerCase();
  filteredItems = kw ? base.filter(i => i.text.toLowerCase().includes(kw)) : base;
  renderList();
}

function renderList() {
  historyListEl.innerHTML = '';
  if (filteredItems.length === 0) {
    emptyStateEl.classList.add('visible'); historyListEl.style.display = 'none'; return;
  }
  emptyStateEl.classList.remove('visible'); historyListEl.style.display = 'block';
  filteredItems.forEach(item => {
    const li = document.createElement('li'); li.className = 'history-item'; li.dataset.id = item.id;
    li.innerHTML = `<div class="history-content"><div class="history-text">${escapeHtml(item.text)}</div><div class="history-time">${formatTime(item.createdAt)}</div></div>
      <div class="history-actions"><button class="action-btn fav${item.favorite?' active':''}" title="收藏">${item.favorite?'⭐':'☆'}</button>
      <button class="action-btn copy" title="复制">📋</button><button class="action-btn delete" title="删除">🗑️</button></div>`;
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
  try { window.electronAPI.writeClipboard(item.text); lastClipboardText = item.text; showToast('已复制'); }
  catch (e) { showToast('复制失败'); }
}
async function deleteItem(id) {
  const idx = historyItems.findIndex(i => i.id === id);
  if (idx === -1) return;
  historyItems.splice(idx, 1); await saveHistory(); renderTimeline(); renderFolders(); applySearch();
}

// ============================================================
//  新建文件夹弹窗
// ============================================================
newFolderBtn.addEventListener('click', () => {
  renameTarget = null; folderModal._pendingFav = null;
  folderModal.style.display = 'flex'; modalTitle.textContent = '新建文件夹'; modalInput.value = ''; modalInput.placeholder = '输入文件夹名称'; modalInput.focus();
});
modalConfirmBtn.addEventListener('click', () => {
  const name = modalInput.value.trim();
  if (!name) return;
  if (renameTarget) {
    renameFolder(renameTarget, name);
    renameTarget = null;
    folderModal.style.display = 'none';
  } else {
    createFolder(name);
    folderModal.style.display = 'none';
    // 如果是从收藏弹窗过来新建的，自动收藏到新文件夹
    const pendingFav = folderModal._pendingFav;
    if (pendingFav) {
      folderModal._pendingFav = null;
      setFavorite(pendingFav, name);
    }
  }
});
modalCancelBtn.addEventListener('click', () => { folderModal.style.display = 'none'; renameTarget = null; folderModal._pendingFav = null; });
folderModal.addEventListener('click', (e) => { if (e.target === folderModal) { folderModal.style.display = 'none'; renameTarget = null; folderModal._pendingFav = null; } });
modalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') modalConfirmBtn.click(); if (e.key === 'Escape') { folderModal.style.display = 'none'; renameTarget = null; folderModal._pendingFav = null; } });

// ============================================================
//  事件绑定
// ============================================================
function bindEvents() {
  timelineAllBtn.addEventListener('click', selectAllItems);
  searchInputEl.addEventListener('input', (e) => { currentSearch = e.target.value.trim(); updateClearSearchBtn(); applySearch(); });
  clearSearchBtn.addEventListener('click', () => { searchInputEl.value = ''; currentSearch = ''; updateClearSearchBtn(); applySearch(); searchInputEl.focus(); });
  minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow && window.electronAPI.minimizeWindow());
  closeBtn.addEventListener('click', () => window.electronAPI.closeWindow && window.electronAPI.closeWindow());
}
function updateClearSearchBtn() { searchInputEl.parentElement.classList.toggle('has-value', !!currentSearch); }

// ============================================================
//  工具
// ============================================================
function showToast(msg) {
  toastEl.textContent = msg; toastEl.classList.add('show');
  if (showToast._t) clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove('show'), 1500);
}
function formatTime(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function escapeHtml(t) { const div = document.createElement('div'); div.textContent = t; return div.innerHTML; }
