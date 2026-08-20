const state = {
  data: null,
  entryCollapsed: new Set(), // 条目级折叠（gi:ei）
  groupCollapsed: new Set(), // 分组级折叠（键为分组名）
  groupTouched: new Set(),   // 用户手动点开/收缩过的分组，不再被默认配置覆盖
  navActive: 0
};

/* 依据配置 defaultCollapsed，把指定分组整体默认收缩（仅针对未被用户手动切换过的分组）；
   收缩后该分组下的所有条目都隐藏，条目本身默认保持展开。 */
function applyDefaultCollapse() {
  const set = new Set((state.data && state.data.defaultCollapsed) || []);
  state.data.groups.forEach((g) => {
    if (!set.has(g.name)) return;
    if (!state.groupTouched.has(g.name)) state.groupCollapsed.add(g.name);
  });
}

const el = {
  nav: document.getElementById('titleNav'),
  content: document.getElementById('content'),
  toast: document.getElementById('toast')
};

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* 分组图标池（彩色 emoji）：索引兜底，关键字优先匹配使图标贴合分组含义 */
const GROUP_ICONS = [
  '👤',   // 人（基本信息）
  '🎓',   // 毕业帽（教育）
  '💼',   // 公文包（工作）
  '🚀',   // 星/火箭（项目）
  '🏅',   // 奖章（技能证书）
  '📄'    // 兜底
];

const ICON_KEYWORDS = [
  [/基本|联系|个人|信息|社交|简介/, 0],
  [/教育|学校|学历|学习|学位|培训/, 1],
  [/工作|公司|职业|任职|实习/, 2],
  [/项目|作品|开发|开源|研究|成就/, 3],
  [/技能|证书|能力|资质|语言|荣誉/, 4]
];

function iconFor(name, index) {
  for (const [re, i] of ICON_KEYWORDS) if (re.test(name)) return GROUP_ICONS[i];
  return GROUP_ICONS[index % GROUP_ICONS.length];
}

async function copy(text, label) {
  await window.api.copyText(text);
  toast(`已复制：${label}`);
}

function renderNav() {
  el.nav.innerHTML = '';
  state.data.groups.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn' + (i === state.navActive ? ' active' : '');
    btn.textContent = iconFor(g.name, i);
    btn.title = g.name;
    btn.onclick = () => {
      const target = document.getElementById('group-' + i);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    el.nav.appendChild(btn);
  });
}

function renderContent() {
  el.content.innerHTML = '';
  state.data.groups.forEach((g, gi) => {
    const section = document.createElement('section');
    section.className = 'group-section';
    section.id = 'group-' + gi;

    const groupCollapsed = state.groupCollapsed.has(g.name);

    const sectionHead = document.createElement('div');
    sectionHead.className = 'section-head' + (groupCollapsed ? ' collapsed' : '');
    sectionHead.innerHTML = '<span class="arrow"></span>' +
      '<span class="group-icon">' + iconFor(g.name, gi) + '</span>' + escapeHtml(g.name);

    // 分组整体收缩：包住所有条目，收缩后整组隐藏
    const groupBody = document.createElement('div');
    groupBody.className = 'group-body' + (groupCollapsed ? '' : ' open');

    sectionHead.onclick = () => {
      state.groupTouched.add(g.name);
      if (state.groupCollapsed.has(g.name)) state.groupCollapsed.delete(g.name);
      else state.groupCollapsed.add(g.name);
      sectionHead.classList.toggle('collapsed', state.groupCollapsed.has(g.name));
      groupBody.classList.toggle('open', !state.groupCollapsed.has(g.name));
    };

    g.entries.forEach((entry, ei) => {
      const key = gi + ':' + ei;
      const collapsed = state.entryCollapsed.has(key);
      const card = document.createElement('section');
      card.className = 'card';

      const head = document.createElement('header');
      head.className = 'entry-head' + (collapsed ? ' collapsed' : '');
      head.innerHTML = '<span class="arrow"></span><span class="entry-title">' +
        escapeHtml(entry.title || '未命名') + '</span>';
      const body = document.createElement('div');
      body.className = 'entry-body' + (collapsed ? '' : ' open');

      head.onclick = () => {
        if (state.entryCollapsed.has(key)) state.entryCollapsed.delete(key);
        else state.entryCollapsed.add(key);
        head.classList.toggle('collapsed', state.entryCollapsed.has(key));
        body.classList.toggle('open', !state.entryCollapsed.has(key));
      };

      entry.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'item-row';
        row.innerHTML =
          '<div class="item-main">' +
          '<span class="item-label">' + escapeHtml(item.label) + '</span>' +
          '<span class="item-value">' + escapeHtml(item.value) + '</span>' +
          '</div>';
        row.onclick = () => copy(item.value, item.label);
        // 原样保留内容，供渲染后据此生成悬浮提示
        row.dataset.label = item.label;
        row.dataset.value = item.value;
        body.appendChild(row);
      });

      card.appendChild(head);
      card.appendChild(body);
      groupBody.appendChild(card);
    });

    section.appendChild(sectionHead);
    section.appendChild(groupBody);
    el.content.appendChild(section);
  });

  applyRowTitles();
}

/* 渲染完成后统一写入悬浮提示：
   换行或超宽被省略的内容，把完整值追加到原生 title 中（换行展示在“点击复制”下方） */
function applyRowTitles() {
  el.content.querySelectorAll('.item-row').forEach((row) => {
    const valueEl = row.querySelector('.item-value');
    const full = row.dataset.value || '';
    const needsFull = full.includes('\n') || valueEl.scrollWidth > valueEl.clientWidth + 1;
    row.title = (row.dataset.label || '') + '（点击复制）' + (needsFull ? '\n' + full : '');
  });
}

function updateNav() {
  const sections = el.content.querySelectorAll('.group-section');
  let current = 0;
  sections.forEach((s, i) => {
    if (s.getBoundingClientRect().top <= 60) current = i;
  });
  if (current !== state.navActive) {
    state.navActive = current;
    el.nav.querySelectorAll('.nav-btn').forEach((b, i) => {
      b.classList.toggle('active', i === current);
    });
  }
}

function render() {
  applyDefaultCollapse();
  renderContent();
  renderNav();
  updateNav();
}

function showError(msg) {
  el.nav.innerHTML = '';
  el.content.innerHTML = '<div class="error">' + escapeHtml(msg) + '</div>';
}

async function init() {
  try {
    state.data = await window.api.loadConfig();
    render();
  } catch (e) {
    showError('配置文件解析失败：' + e.message);
  }
  el.content.addEventListener('scroll', updateNav, { passive: true });
  window.api.onConfigChanged((data) => {
    state.data = data;
    render();
  });
}

document.getElementById('btnConfig').onclick = () => window.api.openConfig();

document.getElementById('btnRefresh').onclick = async () => {
  try {
    state.data = await window.api.reloadConfig();
    render();
    toast('配置已刷新');
  } catch (e) {
    showError('配置文件解析失败：' + e.message);
  }
};

document.getElementById('btnFolder').onclick = async () => {
  const res = await window.api.openFolder();
  if (!res) toast('未设置文件夹路径，请在配置文件 openFolder 中指定');
  else if (!res.ok) toast('打开失败：' + (res.error || '路径不存在'));
  else toast('已打开文件夹');
};

let topOn = true;
document.getElementById('btnTop').onclick = async () => {
  topOn = !topOn;
  await window.api.setTop(topOn);
  const btnTop = document.getElementById('btnTop');
  btnTop.classList.toggle('pinned', topOn);
  btnTop.title = topOn ? '取消置顶' : '置顶';
  toast(topOn ? '已开启置顶' : '已关闭置顶');
};

document.getElementById('btnClose').onclick = () => window.api.closeWindow();

init();