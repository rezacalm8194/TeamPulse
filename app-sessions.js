// TeamPulse deferred UI — sessions board.
// Loaded when the sessions page opens.
function sessionsBoardFilter(){try{const v=localStorage.getItem('tp_sessions_board_filter')||'all';return ['all','open','overdue','no_month'].includes(v)?v:'all';}catch{return 'all';}}

function setSessionsBoardFilter(value){const allowed=new Set(['all','open','overdue','no_month']);const next=allowed.has(value)?value:'all';try{localStorage.setItem('tp_sessions_board_filter',next);}catch{}renderSessions();}

function sessionGroupMatchesBoardFilter(g,filter,todayParts){
  const [ty,tm]=todayParts||_todayJalali();
  const fus=(g.sessions||[]).flatMap(s=>s.followups||[]);
  if(filter==='open')return fus.some(f=>!f.done);
  if(filter==='overdue')return fus.some(f=>_sessionFollowupOverdue(f));
  if(filter==='no_month')return !(g.sessions||[]).some(s=>{const[y,m]=_jalaliParse(s.date_jalali||'');return y===ty&&m===tm;});
  if(filter==='key')return (g.sessions||[]).some(s=>s.importance==='key'||s.flagged);
  return true;
}

function sessionsBoardFilterHtml(active){
  const chips=[
    ['all','همه','همه ستون‌ها'],
    ['open','اقدام‌باز','حداقل یک اقدام باز تا جلسه بعد'],
    ['overdue','موعدگذشته','اقدام باز با موعد قبل از امروز'],
    ['no_month','بی‌جلسهٔ‌ماه','در ماه جاری جلالی جلسه‌ای ثبت نشده'],
  ];
  return '<div class="sessions-board-filters" role="toolbar" aria-label="فیلتر بورد جلسات">'+chips.map(([id,short,full])=>'<button type="button" class="sessions-board-filter-chip'+(active===id?' active':'')+'" title="'+full+'" aria-label="'+full+'" aria-pressed="'+(active===id?'true':'false')+'" onclick="setSessionsBoardFilter(\''+id+'\')">'+short+'</button>').join('')+'</div>';
}


async function renderSessions(search = '') {
  await _ensureCompleteBusinessParts(['students', 'sessions']);
  const sessionPaging = _businessPagingState('sessions');
  const prevScroll = document.getElementById('sessions-board')?.scrollLeft || 0;
  updateTopbarActions(`
    <div class="table-search stu-topbar-search" style="margin-left:8px">
      <span class="search-toggle-icon" style="color:var(--text3)">🔍</span>
      <input placeholder="جستجوی ${META.entitySingular||'شاگرد'}..." oninput="queueRenderSessions(this.value)" value="${escapeHtml(search)}">
    </div>
    <div style="display:flex;align-items:stretch;border:1px solid var(--border2);border-radius:12px;overflow:hidden;background:var(--bg2);flex-shrink:0">
      <button class="btn btn-primary" onclick="openAddSessionGeneral()" style="border-radius:0;border:none;box-shadow:none">+ ثبت ${META.sessionSingular || 'جلسه'}</button>
      <button class="btn btn-ghost" onclick="openStudentModal()" style="border-radius:0;border:0;border-right:1px solid var(--border2)">+ افزودن ${META.entitySingular || 'شاگرد'}</button>
    </div>
  `);
  allStudents = await window.api.students.getAll();
  const groups = await window.api.sessions.getAll();
  const keyOnes = await window.api.sessions.keyOnes();

  let html = studentSectionNav('sessions');

  // ── Board: students as vertical columns, in stable user-defined order ────
  const savedOrder = await window.api.sessions.getOrder();
  let groupsSorted;
  if (savedOrder && savedOrder.length) {
    const byId = new Map(groups.map(g => [g.student_id, g]));
    groupsSorted = savedOrder.map(id => byId.get(id)).filter(Boolean);
    groups.forEach(g => { if (!savedOrder.includes(g.student_id)) groupsSorted.push(g); });
  } else {
    groupsSorted = groups.slice();
  }

  if (search) {
    groupsSorted = groupsSorted.filter(g => (g.name + g.lname).includes(search));
  }
  const boardFilter = sessionsBoardFilter();
  const todayParts = _todayJalali();
  groupsSorted = groupsSorted.filter(g => sessionGroupMatchesBoardFilter(g, boardFilter, todayParts));

  html += sessionsBoardFilterHtml(boardFilter);

  if (groupsSorted.length === 0) {
    setContent(html + `<div class="empty"><span>🔍</span>چیزی پیدا نشد</div>`);
    return;
  }
  const _boardCap = Math.max(SESSION_BOARD_COLUMN_CHUNK, Number(_sessionBoardShown || SESSION_BOARD_COLUMN_CHUNK));
  const _boardHidden = Math.max(0, groupsSorted.length - _boardCap);
  groupsSorted = groupsSorted.slice(0, _boardCap);
  window._sessionBoardHiddenCount = _boardHidden;

  // Compute open followup counts per student
  const followupCounts = {};
  const overdueCounts = {};
  groupsSorted.forEach(g => {
    let openCount = 0, overdueCount = 0;
    g.sessions.forEach(s => { (s.followups||[]).forEach(f => { if (!f.done) { openCount++; if (_sessionFollowupOverdue(f)) overdueCount++; } }); });
    followupCounts[g.student_id] = openCount;
    overdueCounts[g.student_id] = overdueCount;
  });

  html += `<div class="sessions-board" id="sessions-board">`;
  groupsSorted.forEach(g => {
    const openFU = followupCounts[g.student_id] || 0;
    html += `
    <div class="session-column" draggable="true" data-student-id="${g.student_id}">
      <div class="session-column-header">
        <div class="scn-title-row">
          <span class="scn-name" style="cursor:move" title="برای تغییر ترتیب، بکش و رها کن">⠿ ${escapeHtml(g.name)} ${escapeHtml(g.lname)}</span>
          ${studentBoardPinHtml(g.student_id)}
          <span class="scn-count">(${fa(g.sessions.length)})</span>
          ${openFU > 0 ? `<span title="اقدامات باز" onclick="openStudentFollowups(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})" class="session-fu-badge${(overdueCounts[g.student_id]||0)>0?' is-overdue':''}">${fa(openFU)}${(overdueCounts[g.student_id]||0)>0?'!':''}</span>` : ''}
        </div>
        <button class="archive-btn" title="انتقال به بایگانی" onclick="archiveStudent(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">📦 بایگانی این ${META.entitySingular||'شاگرد'}</button>
        <button class="topics-btn" onclick="openTopics(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">📌 موضوعات مهم</button>
        <button class="key-events-btn" onclick="openKeyEvents(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">🌟 رویدادهای مهم</button>
        <button class="summary-btn" onclick="openSessionsSummary(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">📋 خلاصه کل ${META.sessionPlural||'جلسات'}</button>
        <button class="eval-btn" onclick="openEvaluation(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">📊 ارزیابی عملکرد</button>
        <button class="session-column-add" onclick="openAddSessionGeneral(${g.student_id})">+ افزودن ${META.sessionSingular||'جلسه'}</button>
      </div>
      <div class="session-column-body">
        ${g.sessions.length === 0
          ? `<div class="empty" style="padding:14px;font-size:11px"><span>📅</span>هنوز ${META.sessionSingular||'جلسه'}‌ای ثبت نشده</div>`
          : (() => { const _vis = g.sessions.slice(0, 8); const _hid = g.sessions.length - _vis.length; return _vis.map(s => `
          <div class="session-card ${s.importance==='key' ? 'key' : ''}" onclick="openSessionDetail(${s.id})">
            <div class="sc-date">${s.importance==='key' ? '⭐ ' : ''}${DateService.disp(s.date_jalali)} <span style="color:var(--text3);font-weight:400">(${jalaliWeekdayName(s.date_jalali)})</span></div>
            <div class="sc-title">${escapeHtml(s.title) || '(بدون عنوان)'}</div>
            ${s.note ? `<div class="sc-excerpt">${escapeHtml(excerpt(s.note, 60))}</div>` : ''}
          </div>`).join('') + (_hid > 0 ? `<button type="button" class="btn btn-ghost btn-sm" style="width:100%;margin-top:6px" onclick="openSessionsSummary(${g.student_id}, ${escapeAttr((g.name) + ' ' + (g.lname))})">+${fa(_hid)} جلسه دیگر</button>` : ''); })()}
      </div>
    </div>`;
  });
  if (window._sessionBoardHiddenCount > 0) {
    html += '<div id="sessions-board-sentinel" aria-hidden="true" style="flex:0 0 1px;width:1px;min-width:1px;align-self:stretch;opacity:0;pointer-events:none"></div>';
  }
  html += `</div>`;

  // ── Key sessions summary — horizontal scroll AFTER board ──────────────
  if (!search && keyOnes.length > 0) {
    html += `
    <div class="detail-section key-sessions-panel" id="key-sessions-panel" style="border-color:var(--amber);margin-top:24px;background:linear-gradient(135deg,var(--bg2) 0%,rgba(251,191,36,.05) 100%)">
      <button class="key-sessions-toggle" onclick="toggleKeySessionsPanel()" aria-expanded="${_keySessionsExpanded ? 'true' : 'false'}">
        <span>⭐ نکات مهم و کلیدی</span>
        <span class="key-sessions-count">${fa(keyOnes.length)} مورد</span>
        <span class="key-sessions-arrow">${_keySessionsExpanded ? '−' : '+'}</span>
      </button>
      <div class="key-sessions-row" id="key-sessions-row" style="${_keySessionsExpanded ? '' : 'display:none'}">
        ${_keySessionsExpanded ? keyOnes.map(s => `
          <div class="key-session-card" onclick="openSessionDetail(${s.id})">
            <div class="ks-top">
              <span class="ks-name">${escapeHtml(s.name)} ${escapeHtml(s.lname)}</span>
              <span class="ks-date">${DateService.disp(s.date_jalali)}</span>
            </div>
            <div class="ks-title">${escapeHtml(s.title) || '(بدون عنوان)'}</div>
            <div class="ks-excerpt">${renderRich(excerpt(s.note))}</div>
          </div>`).join('') : ''}
      </div>
    </div>`;
  }

  setContent((html || `<div class="empty"><span>📅</span>${META.entitySingular||'شاگردی'} ثبت نشده</div>`) +
    (sessionPaging.done ? '' : '<button class="todo-show-more" onclick="_loadMoreBusiness(\'sessions\')">دریافت جلسات بیشتر</button>'));
  if (!search) initSessionsDragDrop();
  _tpBindLazyLoaders();

  const board = document.getElementById('sessions-board');
  if (board) board.scrollLeft = prevScroll;
  if (!search && !_keySessionsExpanded) {
    requestAnimationFrame(() => {
      const contentEl = document.getElementById('content');
      if (contentEl) contentEl.scrollTop = 0;
    });
  }

  if (search) {
    requestAnimationFrame(() => {
      const si = document.querySelector('#topbar-actions .table-search input') ||
                 document.querySelector('.table-search input');
      if (si) { si.focus(); try { si.setSelectionRange(search.length, search.length); } catch(e){} }
    });
  }
}


function toggleKeySessionsPanel() {
  _keySessionsExpanded = !_keySessionsExpanded;
  renderSessions().then(() => {
    if (!_keySessionsExpanded) return;
    requestAnimationFrame(() => {
      const panel = document.getElementById('key-sessions-panel');
      if (!panel) return;
      panel.setAttribute('tabindex', '-1');
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    });
  });
}


function initSessionsDragDrop() {
  const board = document.getElementById('sessions-board');
  if (!board) return;
  let dragEl = null;

  board.querySelectorAll('.session-column').forEach(col => {
    col.addEventListener('dragstart', () => {
      dragEl = col;
      col.style.opacity = '0.4';
    });
    col.addEventListener('dragend', () => {
      col.style.opacity = '';
      saveSessionsOrder();
    });
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === col) return;
      const rect = col.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      board.insertBefore(dragEl, before ? col : col.nextSibling);
    });
  });
}


async function saveSessionsOrder() {
  const board = document.getElementById('sessions-board');
  if (!board) return;
  const order = [...board.querySelectorAll('.session-column[data-student-id]')].map(el => +el.dataset.studentId).filter(id => Number.isFinite(id));
  await window.api.sessions.setOrder(order);
}


