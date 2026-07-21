/**
 * ============================================================
 * renderer.js —— Electron 的【渲染进程】逻辑
 * ============================================================
 *
 * 渲染进程负责：
 *   1. 接收主进程推送的新剪贴板内容并记录
 *   2. 把新内容加入历史记录，并保存到本地 JSON
 *   3. 构建左侧时间线（年月 → 日时两级分组）
 *   4. 渲染历史列表（按时间倒序，支持时间过滤 + 关键词搜索）
 *   5. 点击条目或"复制"按钮，把文本写回系统剪贴板
 *   6. 点击"删除"按钮，移除单条记录
 * ============================================================
 */

// --------------------------------------------------
// 全局状态
// --------------------------------------------------
let historyItems = [];          // 所有历史记录
let filteredItems = [];         // 最终显示在列表里的记录（时间过滤 + 关键词过滤后）
let lastClipboardText = '';     // 上一次记录的剪贴板内容，用于去重
let currentSearch = '';         // 当前搜索关键词
let currentTimeFilter = null;   // 当前时间过滤 { yearMonth, dayHour } | null=全部
let expandedMonth = null;       // 当前展开的年月

const MAX_HISTORY = 5000;

// --------------------------------------------------
// DOM 元素引用
// --------------------------------------------------
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

// --------------------------------------------------
// 初始化
// --------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await loadHistory();

  if (window.electronAPI.onNewClipboardItem) {
    window.electronAPI.onNewClipboardItem((newItem) => {
      handleNewClipboardItem(newItem);
    });
  } else {
    console.error('【错误】onNewClipboardItem 不可用');
  }

  bindEvents();

  if (window.electronAPI.onThemeChange) {
    window.electronAPI.onThemeChange((theme) => {
      console.log('系统主题切换为：', theme);
    });
  }
});

// --------------------------------------------------
// 处理主进程推送的新剪贴板内容
// --------------------------------------------------
async function handleNewClipboardItem(newItem) {
  try {
    if (!newItem.text || newItem.text === lastClipboardText) return;
    lastClipboardText = newItem.text;

    const latest = historyItems[0];
    if (latest && latest.text === newItem.text) return;

    historyItems.unshift(newItem);
    if (historyItems.length > MAX_HISTORY) {
      historyItems = historyItems.slice(0, MAX_HISTORY);
    }

    await saveHistory();
    renderTimeline();      // 新数据进来，更新时间线
    applySearch();
  } catch (error) {
    console.error('处理剪贴板内容出错：', error);
  }
}

// --------------------------------------------------
// 加载本地历史记录
// --------------------------------------------------
async function loadHistory() {
  try {
    historyItems = await window.electronAPI.loadHistory();
    if (!Array.isArray(historyItems)) historyItems = [];
    historyItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (historyItems.length > 0) {
      lastClipboardText = historyItems[0].text;
    }

    renderTimeline();
    applySearch();
  } catch (error) {
    console.error('加载历史记录失败：', error);
    historyItems = [];
  }
}

// --------------------------------------------------
// 保存历史记录
// --------------------------------------------------
async function saveHistory() {
  try {
    await window.electronAPI.saveHistory(historyItems);
  } catch (error) {
    console.error('保存历史记录失败：', error);
  }
}

// ============================================================
//  时间线数据分组与渲染
// ============================================================

/**
 * 按年月 → 日时两级分组，返回排序后的分组数组
 * 结构: [{ yearMonth, label, items, subGroups: [{ dayHour, items }] }]
 */
function buildTimelineData() {
  const groups = new Map();

  for (const item of historyItems) {
    const d = new Date(item.createdAt);
    const yearMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dayHour = `${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}时`;

    if (!groups.has(yearMonth)) {
      groups.set(yearMonth, {
        yearMonth,
        label: formatYearMonth(yearMonth),
        items: [],
        subMap: new Map()
      });
    }
    const g = groups.get(yearMonth);
    g.items.push(item);

    if (!g.subMap.has(dayHour)) {
      g.subMap.set(dayHour, []);
    }
    g.subMap.get(dayHour).push(item);
  }

  // 按时间倒序排列年月
  const result = Array.from(groups.values())
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  // 每组内子分组也按倒序排列
  for (const g of result) {
    g.subGroups = Array.from(g.subMap.entries())
      .map(([dayHour, items]) => ({ dayHour, label: dayHour, items }))
      .sort((a, b) => b.dayHour.localeCompare(a.dayHour));
    delete g.subMap;
  }

  return result;
}

/**
 * 格式化年月：2026-07 → 2026年07月
 */
function formatYearMonth(ym) {
  const [y, m] = ym.split('-');
  return `${y}年${m}月`;
}

/**
 * 渲染时间线 DOM
 */
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
    // === 大球节点 ===
    const bigNode = document.createElement('div');
    bigNode.className = 'timeline-big-node';
    if (expandedMonth === group.yearMonth) {
      bigNode.classList.add('expanded');
    }

    bigNode.innerHTML = `
      <div class="timeline-big-dot"></div>
      <span class="timeline-big-label">${group.label}</span>
      <span class="timeline-big-count">${group.items.length}条</span>
      <span class="timeline-big-arrow">▶</span>
    `;

    bigNode.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleExpand(group);
    });

    timelineNodesEl.appendChild(bigNode);

    // === 小球子列表 ===
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'timeline-children';
    if (expandedMonth === group.yearMonth) {
      childrenWrap.classList.add('open');
    }

    group.subGroups.forEach((sub) => {
      const smallNode = document.createElement('div');
      smallNode.className = 'timeline-small-node';

      // 高亮当前选中的小时节点
      if (currentTimeFilter &&
          currentTimeFilter.yearMonth === group.yearMonth &&
          currentTimeFilter.dayHour === sub.dayHour) {
        smallNode.classList.add('active');
      }

      smallNode.innerHTML = `
        <div class="timeline-small-dot"></div>
        <span class="timeline-small-label">${sub.dayHour}</span>
        <span class="timeline-small-count">${sub.items.length}条</span>
      `;

      smallNode.addEventListener('click', (e) => {
        e.stopPropagation();
        selectTimeNode(group.yearMonth, sub.dayHour);
      });

      childrenWrap.appendChild(smallNode);
    });

    timelineNodesEl.appendChild(childrenWrap);
  });
}

/**
 * 展开/折叠年月节点
 */
function toggleExpand(group) {
  if (expandedMonth === group.yearMonth) {
    // 已展开 → 折叠
    expandedMonth = null;
    // 折叠后如之前是选中该月的子节点，清除过滤
    if (currentTimeFilter && currentTimeFilter.yearMonth === group.yearMonth) {
      clearTimeFilter();
    }
  } else {
    // 折叠之前展开的，展开当前
    expandedMonth = group.yearMonth;
    // 如果之前是另一个月的子节点选中，清除过滤
    if (currentTimeFilter && currentTimeFilter.yearMonth !== group.yearMonth) {
      clearTimeFilter();
    }
  }
  renderTimeline();
  applySearch();
}

/**
 * 选中一个小球节点 → 按时间过滤
 */
function selectTimeNode(yearMonth, dayHour) {
  currentTimeFilter = { yearMonth, dayHour };
  updateTimelineAllBtn();
  renderTimeline();
  applySearch();
}

/**
 * 清除时间过滤，显示全部
 */
function clearTimeFilter() {
  currentTimeFilter = null;
  updateTimelineAllBtn();
  renderTimeline();
  applySearch();
}

/**
 * 更新"全部"按钮激活状态
 */
function updateTimelineAllBtn() {
  if (currentTimeFilter) {
    timelineAllBtn.classList.remove('active');
  } else {
    timelineAllBtn.classList.add('active');
  }
}

// ============================================================
//  搜索 + 时间过滤 + 列表渲染
// ============================================================

/**
 * 在时间过滤的基础上叠加关键词搜索，更新 filteredItems
 */
function applySearch() {
  // 第一步：时间过滤
  let baseItems;
  if (currentTimeFilter) {
    baseItems = historyItems.filter(item => {
      const d = new Date(item.createdAt);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dh = `${String(d.getDate()).padStart(2, '0')}日 ${String(d.getHours()).padStart(2, '0')}时`;
      return ym === currentTimeFilter.yearMonth && dh === currentTimeFilter.dayHour;
    });
  } else {
    baseItems = [...historyItems];
  }

  // 第二步：关键词过滤
  const keyword = currentSearch.toLowerCase();
  if (!keyword) {
    filteredItems = baseItems;
  } else {
    filteredItems = baseItems.filter(item =>
      item.text.toLowerCase().includes(keyword)
    );
  }

  renderList();
}

/**
 * 渲染右侧历史列表
 */
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

    li.innerHTML = `
      <div class="history-content">
        <div class="history-text">${escapeHtml(item.text)}</div>
        <div class="history-time">${formatTime(item.createdAt)}</div>
      </div>
      <div class="history-actions">
        <button class="action-btn copy" title="复制到剪贴板">📋</button>
        <button class="action-btn delete" title="删除">🗑️</button>
      </div>
    `;

    li.addEventListener('click', (e) => {
      if (e.target.closest('.action-btn')) return;
      copyItem(item.id);
    });

    li.querySelector('.action-btn.copy').addEventListener('click', (e) => {
      e.stopPropagation();
      copyItem(item.id);
    });

    li.querySelector('.action-btn.delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteItem(item.id);
    });

    historyListEl.appendChild(li);
  });
}

// ============================================================
//  操作：复制 / 删除
// ============================================================

async function copyItem(id) {
  const item = historyItems.find(i => i.id === id);
  if (!item) return;

  try {
    window.electronAPI.writeClipboard(item.text);
    lastClipboardText = item.text;
    showToast('已复制');
  } catch (error) {
    console.error('复制失败：', error);
    showToast('复制失败');
  }
}

async function deleteItem(id) {
  const index = historyItems.findIndex(i => i.id === id);
  if (index === -1) return;

  historyItems.splice(index, 1);
  await saveHistory();
  renderTimeline();   // 删了条目后更新时间线
  applySearch();
}

// ============================================================
//  事件绑定
// ============================================================

function bindEvents() {
  // "全部"按钮 — 清除时间过滤
  timelineAllBtn.addEventListener('click', () => {
    clearTimeFilter();
  });

  // 搜索框
  searchInputEl.addEventListener('input', (e) => {
    currentSearch = e.target.value.trim();
    console.log('【搜索】关键词 =', currentSearch);
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
  minimizeBtn.addEventListener('click', () => {
    if (window.electronAPI.minimizeWindow) window.electronAPI.minimizeWindow();
  });

  closeBtn.addEventListener('click', () => {
    if (window.electronAPI.closeWindow) window.electronAPI.closeWindow();
  });
}

function updateClearSearchButton() {
  const searchBox = searchInputEl.parentElement;
  if (currentSearch) {
    searchBox.classList.add('has-value');
  } else {
    searchBox.classList.remove('has-value');
  }
}

// ============================================================
//  工具函数
// ============================================================

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');

  // 防止快速多次触发导致前一个 toast 残留
  if (showToast._timeout) clearTimeout(showToast._timeout);
  showToast._timeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 1500);
}

function formatTime(isoString) {
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
