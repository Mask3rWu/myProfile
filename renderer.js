const state = {
  data: null,
  entryCollapsed: new Set(), // 条目级折叠（gi:ei）
  groupCollapsed: new Set(), // 分组级折叠（键为分组名）
  groupTouched: new Set(),   // 用户手动点开/收缩过的分组，不再被默认配置覆盖
  navActive: 0,
  editing: false,            // 是否处于编辑模式
  editData: null,            // 编辑模式的在内存副本（保存前不动磁盘）
  skipCollect: false,        // 拖拽重排后重渲染时，跳过 collectInputs（数组与 DOM 索引已不一致）
  editGroupCollapsed: new Set(), // 编辑表单内分组折叠（键为 gi）
  editEntryCollapsed: new Set()  // 编辑表单内条目折叠（键为 "gi:ei"）
};

// 键值对拖拽的源索引（dragstart 时记录，drop 时消费后置空）
let dragFrom = null;

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
  toast: document.getElementById('toast'),
  edit: document.getElementById('btnEdit')
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

/* ---- 图标（统一为内联 SVG，颜色随 currentColor 走，尺寸统一）---- */
const ICON = {
  // 折叠箭头：基线为「朝右」，展开态由 CSS rotate(90deg) 变为朝下
  chevronRight: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
  // 增加（＋）
  plus: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  // 删除（✕）
  x: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>',
  // 默认折叠（四角向内收缩箭头）
  caretDown: '<svg viewBox="0 0 1024 1024" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M942.1 41H657.9c-20.4 0-39.5 13.8-42.9 34-4.3 25.6 15.5 48 40.4 48h225.3c11.3 0 20.5 9.2 20.5 20.5v222.8c0 20.4 13.8 39.5 34 42.9 25.6 4.3 48-15.5 48-40.4V81.9C983 59.4 964.6 41 942.1 41zM368.6 901.1H143.4c-11.3 0-20.5-9.2-20.5-20.5V657.9c0-20.4-13.8-39.5-34-42.9-25.6-4.3-48 15.5-48 40.4v286.7c0 22.5 18.4 41 41 41h284.2c20.4 0 39.5-13.8 42.9-34 4.3-25.6-15.5-48-40.4-48zM424.5 404c0-0.2-0.1-0.5-0.1-0.7v-204c0-22.5-18.4-41-41-41-22.5 0-41 18.4-41 41v105.8L151.8 114.3c-15.9-15.9-42-15.9-57.9 0-15.9 15.9-15.9 42 0 57.9L284.6 363H178.8c-22.5 0-41 18.4-41 41 0 22.5 18.4 41 41 41h204c0.2 0 0.5 0.1 0.7 0.1 8 0 15.5-2.4 21.8-6.5 0.2-0.2 0.5-0.3 0.8-0.4 2.3-1.5 4.4-3.2 6.3-5.2 1.9-1.9 3.7-4.1 5.2-6.3 0.2-0.2 0.3-0.5 0.4-0.7 4.1-6.5 6.5-14 6.5-22zM739.4 681.5h105.8c22.5 0 41-18.4 41-41 0-22.5-18.4-41-41-41h-204c-0.2 0-0.5-0.1-0.7-0.1-8.1 0-15.5 2.4-21.9 6.5-0.2 0.1-0.5 0.2-0.7 0.4-2.3 1.5-4.4 3.2-6.3 5.2-1.9 1.9-3.7 4.1-5.2 6.3-0.1 0.2-0.2 0.5-0.4 0.7-4.1 6.4-6.5 13.8-6.5 21.9 0 0.2 0.1 0.5 0.1 0.7v204c0 22.5 18.4 41 41 41 22.5 0 41-18.4 41-41V739.4l190.7 190.7c15.9 15.9 42 15.9 57.9 0s15.9-42 0-57.9L739.4 681.5z"/></svg>',
  // 拖拽手柄（≡）
  grip: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>'
};

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

/* 编辑模式导航：与正常视图同款，但数据源用 state.editData，目标定位到 .edit-group */
function renderNavEdit() {
  el.nav.innerHTML = '';
  state.editData.groups.forEach((g, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-btn' + (i === state.navActive ? ' active' : '');
    btn.textContent = iconFor(g.name, i);
    btn.title = g.name;
    btn.onclick = () => {
      const target = el.content.querySelectorAll('.edit-group')[i];
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
    sectionHead.innerHTML = '<span class="arrow">' + ICON.chevronRight + '</span>' +
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
      head.innerHTML = '<span class="arrow">' + ICON.chevronRight + '</span><span class="entry-title">' +
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
    row.title = '（点击复制）' + (needsFull ? '\n' + full : '');
  });
}

function updateNav() {
  const sections = el.content.querySelectorAll(state.editing ? '.edit-group' : '.group-section');
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
  if (state.editing) { renderEdit(); return; }
  applyDefaultCollapse();
  renderContent();
  renderNav();
  updateNav();
}

/* ================= 编辑模式 =================
   进入编辑后，数据操作全部落在 state.editData（state.data 的深拷贝）上，
   只有点「保存」才一次性写回磁盘；写回后由 main 的 fs.watchFile 触发 config:changed
   自动重渲染，回到正常视图。编辑期间正常模式的「点击复制/折叠」交互完全不参与。 */

function editClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function enterEdit() {
  state.editData = editClone(state.data);
  state.editing = true;
  el.edit.classList.add('active');
  el.edit.title = '取消编辑';
  render();
}

function leaveEdit() {
  state.editing = false;
  state.editData = null;
  el.edit.classList.remove('active');
  el.edit.title = '编辑配置';
}

function cancelEdit() {
  leaveEdit();
  render();
}

/* 行内编辑时输入控件是无控制的（自带值），每次结构性重渲染前先把当前 DOM 里
   未提交的文本收集回 editData，避免重建后丢失正在输入的改动。 */
function collectInputs() {
  if (!state.editData) return;
  el.content.querySelectorAll('.edit-groupname').forEach((i) => {
    state.editData.groups[+i.dataset.gi].name = i.value;
  });
  el.content.querySelectorAll('.edit-entryname').forEach((i) => {
    state.editData.groups[+i.dataset.gi].entries[+i.dataset.ei].title = i.value;
  });
  el.content.querySelectorAll('.edit-label-in').forEach((i) => {
    state.editData.groups[+i.dataset.gi].entries[+i.dataset.ei].items[+i.dataset.ii].label = i.value;
  });
  el.content.querySelectorAll('.edit-value').forEach((i) => {
    state.editData.groups[+i.dataset.gi].entries[+i.dataset.ei].items[+i.dataset.ii].value = i.value;
  });
}

/* 内容自增高：宽不换行 / 适配内容，脱离下整个盒子随内容长高，可超出小窗（由滚动容器承接） */
function autosizeValue(t) {
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}

function saveEdit() {
  collectInputs();
  window.api.saveConfig(state.editData).then((res) => {
    if (res && res.ok) {
      state.data = state.editData; // 先落内存，等待 watch 的 config:changed 用磁盘内容对齐
      leaveEdit();
      render();
      toast('已保存');
    } else {
      toast('保存失败：' + ((res && res.error) || '未知错误'));
    }
  });
}

/* ---- 三层 CRUD（全部作用于 state.editData，新增即插入空行并就地聚焦）---- */

function addItem(gi, ei) {
  state.editData.groups[gi].entries[ei].items.push({ label: '', value: '' });
  render();
  focusEdit(gi, ei, state.editData.groups[gi].entries[ei].items.length - 1);
}

function delItem(gi, ei, ii) {
  // 删除仅作用在编辑内存副本，点「保存」才落盘，因此无需确认。
  // 必须先收集（此时数组与 DOM 索引一致）再 splice、再以 skipCollect 重渲染：
  // 否则重渲染第一步按旧索引回写已在 splice 后缩短的数组会越界报错（表现为点击无反应）。
  collectInputs();
  state.editData.groups[gi].entries[ei].items.splice(ii, 1);
  state.skipCollect = true;
  render();
}

function addEntry(gi) {
  state.editData.groups[gi].entries.push({ title: '', items: [] });
  render();
  focusEdit(gi, state.editData.groups[gi].entries.length - 1, undefined);
}

function delEntry(gi, ei) {
  // 同 delItem：先收集再重排，避免重渲染回写旧索引时越界
  collectInputs();
  state.editData.groups[gi].entries.splice(ei, 1);
  state.skipCollect = true;
  render();
}

function addGroup() {
  state.editData.groups.push({ name: '', entries: [] });
  render();
  focusEdit(state.editData.groups.length - 1, undefined, undefined);
}

function delGroup(gi) {
  // 同 delItem：先收集再重排，避免重渲染回写旧索引时越界
  collectInputs();
  state.editData.groups.splice(gi, 1);
  state.skipCollect = true;
  render();
}

/* 重渲染后把焦点落到指定单元格：gi（必填）、ei/ii 可缺省（分组名/条目标题只有 part） */
function focusEdit(gi, ei, ii) {
  const want = { gi: String(gi), ei: ei == null ? '' : String(ei), ii: ii == null ? '' : String(ii) };
  const cell = Array.from(el.content.querySelectorAll('[data-edit]')).find((x) =>
    x.dataset.gi === want.gi && (x.dataset.ei || '') === want.ei && (x.dataset.ii || '') === want.ii);
  if (cell) setTimeout(() => { cell.focus(); if (cell.select) cell.select(); }, 0);
}

/* ---- 键值对拖拽排序（仅编辑模式）---- */

function clearDragMarkers() {
  el.content.querySelectorAll('.edit-item').forEach((w) => {
    w.classList.remove('drag-source', 'drop-before', 'drop-after');
  });
  el.content.querySelectorAll('.drag-handle').forEach((h) => h.classList.remove('dragging'));
}

/* 把 dragFrom 处键值对落到 hover 目标（索引 h）之前/之后。
   顺序必须为：先 collectInputs()（此时数组与 DOM 索引一致，稳妥回收未提交文本）
   → 数组重排 → 以 skipCollect 重渲染（不再按旧 DOM 索引二次回写）。 */
function dropItem(gi, ei, h, ev) {
  const items = state.editData.groups[gi].entries[ei].items;
  const from = dragFrom;
  dragFrom = null;
  clearDragMarkers();
  if (from == null || from === h || from < 0 || from >= items.length) return;
  const r = ev.currentTarget.getBoundingClientRect();
  const after = ev.clientY > r.top + r.height / 2;
  let hFinal = h;
  if (h > from) hFinal = h - 1;
  const insert = after ? hFinal + 1 : hFinal;
  collectInputs();
  const [moved] = items.splice(from, 1);
  items.splice(insert, 0, moved);
  state.skipCollect = true;
  render();
}

/* ---- 编辑表单内的折叠 / 默认折叠 toggle ---- */

function toggleEditGroup(gi) {
  if (state.editGroupCollapsed.has(gi)) state.editGroupCollapsed.delete(gi);
  else state.editGroupCollapsed.add(gi);
  render();
}

function toggleEditEntry(gi, ei) {
  const k = gi + ':' + ei;
  if (state.editEntryCollapsed.has(k)) state.editEntryCollapsed.delete(k);
  else state.editEntryCollapsed.add(k);
  render();
}

/* 把当前分组名加入/移出 defaultCollapsed（正常视图据此默认折叠该分组）。
   先收集文本拿到最新分组名，再写配置标记；defaultCollapsed 按名字与正常视图匹配。 */
function toggleGroupDefaultCollapsed(gi) {
  collectInputs();
  const name = state.editData.groups[gi].name;
  const list = state.editData.defaultCollapsed || (state.editData.defaultCollapsed = []);
  const i = list.indexOf(name);
  if (i >= 0) list.splice(i, 1);
  else list.push(name);
  render();
}

/* ---- 编辑模式渲染 ---- */

function mkBtn(text, cls, onClick, title) {
  const b = document.createElement('button');
  b.className = 'mini-btn ' + (cls || '');
  b.textContent = text;
  b.onclick = onClick;
  if (title) b.title = title;
  return b;
}

/* 图标型按钮：内容为内联 SVG，颜色随 currentColor（danger/active 由父类控制） */
function mkIcon(icon, cls, onClick, title) {
  const b = document.createElement('button');
  b.className = 'mini-btn ' + (cls || '');
  b.innerHTML = icon;
  b.onclick = onClick;
  if (title) b.title = title;
  return b;
}

/* 就地编辑控件：分组/条目标题与键值 label 为单行输入；value 为自增高 textarea（Enter 即换行，文本整体保存） */
function editNameInput(kind, gi, ei, value, placeholder) {
  const inp = document.createElement('input');
  inp.className = 'edit-name ' + (kind === 'group' ? 'edit-groupname' : 'edit-entryname');
  inp.setAttribute('data-edit', kind === 'group' ? 'groupname' : 'entryname');
  inp.dataset.gi = gi;
  if (ei !== undefined) inp.dataset.ei = ei;
  inp.value = value || '';
  inp.placeholder = placeholder || '';
  return inp;
}

function editLabelInput(gi, ei, ii, value) {
  const inp = document.createElement('input');
  inp.className = 'edit-label-in';
  inp.setAttribute('data-edit', 'label');
  inp.dataset.gi = gi; inp.dataset.ei = ei; inp.dataset.ii = ii;
  inp.value = value || '';
  inp.placeholder = '名称';
  return inp;
}

function editValueArea(gi, ei, ii, value) {
  const t = document.createElement('textarea');
  t.className = 'edit-value';
  t.setAttribute('data-edit', 'value');
  t.dataset.gi = gi; t.dataset.ei = ei; t.dataset.ii = ii;
  t.value = value || '';
  t.placeholder = '内容（直接按 Enter 换行）';
  t.rows = 1;
  // Enter 即换行，无需提交：文本统一在「保存」时整体收集落盘
  t.addEventListener('input', () => autosizeValue(t));
  return t;
}

function renderEdit() {
  if (!state.skipCollect) collectInputs(); // 重建前回收未提交的输入，避免结构性变更后丢失
  renderNavEdit();
  el.content.innerHTML = '';

  const bar = document.createElement('div');
  bar.className = 'edit-bar';
  const hint = document.createElement('span');
  hint.className = 'edit-hint';
  hint.textContent = '编辑模式';
  bar.appendChild(hint);
  bar.appendChild(mkBtn('保存', 'primary', saveEdit));
  bar.appendChild(mkBtn('取消', '', cancelEdit));
  el.content.appendChild(bar);

  const data = state.editData;
  data.groups.forEach((g, gi) => {
    const gsection = document.createElement('section');
    gsection.className = 'edit-group';

    const groupCollapsedEdit = state.editGroupCollapsed.has(gi);
    const isDefaultCollapsed = (state.editData.defaultCollapsed || []).includes(g.name);
    const ghead = document.createElement('div');
    ghead.className = 'edit-head' + (groupCollapsedEdit ? ' folded' : '');
    ghead.appendChild(mkIcon(ICON.chevronRight, 'icon collapse', () => toggleEditGroup(gi)));
    const gicon = document.createElement('span');
    gicon.className = 'edit-icon';
    gicon.textContent = iconFor(g.name, gi);
    ghead.appendChild(gicon);
    ghead.appendChild(editNameInput('group', gi, undefined, g.name, '分组名称'));
    const gacts = document.createElement('div');
    gacts.className = 'edit-actions';
    // 默认折叠：图标 toggle（写 defaultCollapsed，正常视图首次进入时折叠该分组）
    gacts.appendChild(mkIcon(ICON.caretDown, 'icon' + (isDefaultCollapsed ? ' active' : ''), () => toggleGroupDefaultCollapsed(gi),
      isDefaultCollapsed ? '取消默认折叠（正常视图收起）' : '设为默认折叠（正常视图收起）'));
    gacts.appendChild(mkIcon(ICON.plus, 'icon', () => addEntry(gi), '添加条目'));
    gacts.appendChild(mkIcon(ICON.x, 'icon danger', () => delGroup(gi), '删除分组'));
    ghead.appendChild(gacts);
    gsection.appendChild(ghead);

    if (!groupCollapsedEdit) g.entries.forEach((entry, ei) => {
      const entryCollapsedEdit = state.editEntryCollapsed.has(gi + ':' + ei);
      const esection = document.createElement('div');
      esection.className = 'edit-entry';

      const ehead = document.createElement('div');
      ehead.className = 'edit-head sub' + (entryCollapsedEdit ? ' folded' : '');
      ehead.appendChild(mkIcon(ICON.chevronRight, 'icon collapse', () => toggleEditEntry(gi, ei)));
      ehead.appendChild(editNameInput('entry', gi, ei, entry.title, '条目标题'));
      const eacts = document.createElement('div');
      eacts.className = 'edit-actions';
      eacts.appendChild(mkIcon(ICON.plus, 'icon', () => addItem(gi, ei), '添加键值'));
      eacts.appendChild(mkIcon(ICON.x, 'icon danger', () => delEntry(gi, ei), '删除条目'));
      ehead.appendChild(eacts);
      esection.appendChild(ehead);

      if (!entryCollapsedEdit) entry.items.forEach((item, ii) => {
        const wrap = document.createElement('div');
        wrap.className = 'edit-item';
        wrap.dataset.ii = ii;

        // 拖拽手柄：draggable 仅在此手柄上，避免与 label/value 的文本选择冲突
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.innerHTML = ICON.grip;
        handle.title = '拖动调整位置';
        handle.draggable = true;
        handle.dataset.gi = gi; handle.dataset.ei = ei; handle.dataset.ii = ii;
        handle.addEventListener('dragstart', (ev) => {
          dragFrom = ii;
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', String(ii));
          const wrap0 = handle.closest('.edit-item');
          if (wrap0) wrap0.classList.add('drag-source');
          setTimeout(() => handle.classList.add('dragging'), 0);
        });
        handle.addEventListener('dragend', () => {
          dragFrom = null;
          clearDragMarkers();
        });

        // 目标行：dragover 持续更新落点指示；drop 完成重排
        wrap.addEventListener('dragover', (ev) => {
          if (dragFrom == null || dragFrom === ii) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = 'move';
          const r2 = wrap.getBoundingClientRect();
          const afl = ev.clientY > r2.top + r2.height / 2;
          wrap.classList.toggle('drop-after', afl);
          wrap.classList.toggle('drop-before', !afl);
        });
        wrap.addEventListener('drop', (ev) => {
          ev.preventDefault();
          dropItem(gi, ei, ii, ev);
        });

        const keyRow = document.createElement('div');
        keyRow.className = 'edit-item-key';
        keyRow.appendChild(handle);
        keyRow.appendChild(editLabelInput(gi, ei, ii, item.label));
        keyRow.appendChild(mkIcon(ICON.x, 'icon danger', () => delItem(gi, ei, ii), '删除键值'));

        wrap.appendChild(keyRow);
        wrap.appendChild(editValueArea(gi, ei, ii, item.value));
        esection.appendChild(wrap);
      });

      gsection.appendChild(esection);
    });

    el.content.appendChild(gsection);
  });

  const addG = document.createElement('div');
  addG.className = 'edit-addgroup';
  addG.appendChild(mkIcon(ICON.plus, 'primary addgroup', addGroup, '添加分组'));
  el.content.appendChild(addG);

  el.content.querySelectorAll('.edit-value').forEach((t) => autosizeValue(t));
  state.skipCollect = false; // 本次（可能跳过了收集的）重建完成，复位供后续正常渲染
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

document.getElementById('btnEdit').onclick = () => {
  if (state.editing) cancelEdit();
  else enterEdit();
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

// 「?」使用说明：在弹出的独立悬浮窗中展示，主进程将其置于鼠标右下角（可脱离本窗边界）
const btnHelp = document.getElementById('btnHelp');
btnHelp.removeAttribute('title'); // 去掉原生 title，避免与自定义提示重复
btnHelp.addEventListener('mouseenter', () => window.api.showHelpTip());
btnHelp.addEventListener('mouseleave', () => window.api.hideHelpTip());

document.getElementById('btnClose').onclick = () => window.api.closeWindow();

init();