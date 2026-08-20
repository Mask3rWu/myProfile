const state = {
  data: null,
  collapsed: new Set(),
  touched: new Set(), // 用户手动点击过的条目，默认折叠不再覆盖它们
  navActive: 0
};

/* 依据配置 defaultCollapsed，把指定分组内的条目默认折叠（仅针对未被用户点击过的条目） */
function applyDefaultCollapse() {
  const set = new Set((state.data && state.data.defaultCollapsed) || []);
  state.data.groups.forEach((g, gi) => {
    if (!set.has(g.name)) return;
    g.entries.forEach((entry, ei) => {
      const key = gi + ':' + ei;
      if (!state.touched.has(key)) state.collapsed.add(key);
    });
  });
}

const el = {
  nav: document.getElementById('titleNav'),
  content: document.getElementById('content'),
  toast: document.getElementById('toast'),
  tip: document.getElementById('tip')
};

/* 悬浮提示控件：在小窗内自适应定位（优先上方，放不下放下方，贴边修正） */
const tip = {
  show(text, anchor) {
    el.tip.textContent = text;
    el.tip.classList.add('show');
    const r = anchor.getBoundingClientRect();
    let x = r.left;
    if (x + el.tip.offsetWidth > window.innerWidth - 8) x = window.innerWidth - el.tip.offsetWidth - 8;
    if (x < 8) x = 8;
    let y = r.top - el.tip.offsetHeight - 8;
    if (y < 8) y = r.bottom + 8;
    el.tip.style.left = x + 'px';
    el.tip.style.top = y + 'px';
  },
  hide() {
    el.tip.classList.remove('show');
  }
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

    const sectionHead = document.createElement('div');
    sectionHead.className = 'section-head';
    sectionHead.innerHTML =
      '<span class="group-icon">' + iconFor(g.name, gi) + '</span>' + escapeHtml(g.name);
    section.appendChild(sectionHead);

    g.entries.forEach((entry, ei) => {
      const key = gi + ':' + ei;
      const card = document.createElement('section');
      card.className = 'card';

      const head = document.createElement('header');
      head.className = 'entry-head' + (state.collapsed.has(key) ? ' collapsed' : '');
      head.innerHTML = '<span class="arrow"></span><span class="entry-title">' +
        escapeHtml(entry.title || '未命名') + '</span>';
      const body = document.createElement('div');
      body.className = 'entry-body' + (state.collapsed.has(key) ? '' : ' open');

      head.onclick = () => {
        state.touched.add(key);
        if (state.collapsed.has(key)) state.collapsed.delete(key);
        else state.collapsed.add(key);
        head.classList.toggle('collapsed', state.collapsed.has(key));
        body.classList.toggle('open', !state.collapsed.has(key));
      };

      entry.items.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'item-row';
        row.title = item.label + '（点击复制）';
        row.innerHTML =
          '<div class="item-main">' +
          '<span class="item-label">' + escapeHtml(item.label) + '</span>' +
          '<span class="item-value">' + escapeHtml(item.value) + '</span>' +
          '</div>';
        row.onclick = () => copy(item.value, item.label);
        const valueEl = row.querySelector('.item-value');
        // 仅当内容确实换行或超宽被省略时，悬浮才展示完整内容；单行短文本不弹提示
        row.addEventListener('mouseenter', () => {
          if (item.value.includes('\n') || valueEl.scrollWidth > valueEl.clientWidth + 1) {
            tip.show(item.value, row);
          }
        });
        row.addEventListener('mouseleave', () => tip.hide());
        body.appendChild(row);
      });

      card.appendChild(head);
      card.appendChild(body);
      section.appendChild(card);
    });

    el.content.appendChild(section);
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