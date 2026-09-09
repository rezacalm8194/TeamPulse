// TeamPulse deferred UI — todos list and calendar.
// Loaded when todos/calendar pages open.
function _todoTabButton(tab, label) {
  const active = _todoActiveTab === tab;
  return `<button class="${active ? 'active' : ''}" role="tab" aria-selected="${active ? 'true' : 'false'}" onclick="_setTodoTab('${tab}')">${label}</button>`;
}


function _setTodoTab(tab) {
  _todoStaffTabExplicit = tab === 'staff';
  _todoActiveTab = tab;
  renderTodoList();
}


function _todoTabsHtml() {
  return '';
}


function _todoTopbarActionsHtml() {
  const tabs = [_todoTabButton('mine','کارهای من')];
  if (_todoCanOpenStaffTasksTab()) tabs.push(_todoTabButton('staff','کارهای پرسنل'));
  return `<div class="payments-segmented todo-topbar-tabs" role="tablist" aria-label="لیست کارها">${tabs.join('')}</div>
    <button class="btn btn-ghost btn-sm todo-archive-btn" onclick="openTodoArchive()" title="بایگانی کارها" aria-label="بایگانی کارها">📦</button>`;
}


function _openMyTodoReport() {
  _todoReportFilter.staffIds = [];
  openModal('📈 گزارش عملکرد خودم', _todoReportHtml(true), [], { size:'large' });
}


function _openStaffTodoReport(staffId) {
  _todoStaffReportId = String(staffId || '');
  _todoStaffFilter.staffId = _todoStaffReportId || _todoStaffFilter.staffId;
  _renderTodoStaffFilteredList();
}


function _openAddTodoForStaff(staffId) {
  if (!_todoCanCreateForStaff(staffId)) { showToast('برای تعریف چک‌لیست این پرسنل دسترسی نداری', 'error'); return; }
  _todoActiveTab = _todoCanOpenStaffTasksTab() ? 'staff' : 'mine';
  openAddTodo('', staffId);
}


function _quickStaffDateShortcut(kind) {
  const today = _todayJalaliStr();
  if (kind === 'today') return today;
  const [jy,jm,jd] = _jalaliParse(today);
  if (kind === 'tomorrow') return _formatJalali(..._addDays(jy,jm,jd,1));
  if (kind === 'week') return _formatJalali(..._addDays(jy,jm,jd,7));
  return today;
}


function _setQuickStaffChecklistDate(kind) {
  const input = document.getElementById('quick-staff-date');
  if (input) input.value = _quickStaffDateShortcut(kind);
}


function _openQuickStaffChecklist(staffId) {
  if (!_todoCanCreateForStaff(staffId)) { showToast('برای تعریف چک‌لیست این پرسنل دسترسی نداری', 'error'); return; }
  const staff = (_db.staff || []).find(s => staffIsPersonnel(s) && String(s.id) === String(staffId));
  if (!staff) { showToast('پرسنل پیدا نشد', 'error'); return; }
  const today = _todayJalaliStr();
  openModal('چک‌لیست سریع', `
    <div style="background:rgba(124,106,247,.10);border:1px solid rgba(124,106,247,.22);border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:900;color:var(--text);margin-bottom:4px">${escapeHtml(_todoStaffName(staff))}</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.8">هر خط یک کار جدا می‌شود. دسترسی پیش‌فرض: فقط مسئول انجام.</div>
    </div>
    <div class="form-group full">
      <label class="form-label">عنوان کارها *</label>
      <textarea class="form-input" id="quick-staff-titles" rows="6" autofocus onkeydown="_tpOnCtrlEnter1(event,'_saveQuickStaffChecklist','${staff.id}')" placeholder="مثلاً:
پیگیری پرداخت مشتری
آماده‌سازی ویدیو
ارسال گزارش روزانه"></textarea>
      <div style="font-size:10px;color:var(--text3);margin-top:5px">برای ذخیره سریع می‌توانی Ctrl+Enter بزنی.</div>
    </div>
    <div class="quick-staff-schedule-grid">
      <div class="form-group">
        <label class="form-label">تاریخ</label>
        <div class="quick-staff-date-row">
          <input class="form-input jdate" id="quick-staff-date" value="${today}">
          <button type="button" class="btn btn-ghost btn-sm" onclick="_setQuickStaffChecklistDate('today')">امروز</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="_setQuickStaffChecklistDate('tomorrow')">فردا</button>
          <button type="button" class="btn btn-ghost btn-sm" onclick="_setQuickStaffChecklistDate('week')">هفته دیگر</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">⏰ ساعت انجام</label>
        <input class="form-input" id="quick-staff-time" type="time" style="direction:ltr">
      </div>
      <div class="form-group">
        <label class="form-label">🔔 یادآوری</label>
        <select class="form-input" id="quick-staff-remind">
          <option value="0" selected>بدون یادآوری</option>
          <option value="5">۵ دقیقه قبل</option>
          <option value="10">۱۰ دقیقه قبل</option>
          <option value="15">۱۵ دقیقه قبل</option>
          <option value="30">۳۰ دقیقه قبل</option>
          <option value="60">۱ ساعت قبل</option>
          <option value="120">۲ ساعت قبل</option>
          <option value="1440">۱ روز قبل</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">🔁 تکرار</label>
        <select class="form-input" id="quick-staff-repeat">
          <option value="none">بدون تکرار</option>
          <option value="daily">روزانه</option>
          <option value="every2days">یک‌روزدرمیان</option>
          <option value="weekly">هفتگی</option>
          <option value="monthly">ماهانه</option>
        </select>
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text2);cursor:pointer">
      <input type="checkbox" id="quick-staff-report" style="width:16px;height:16px;accent-color:var(--accent)">
      برای تکمیل، گزارش بخواهد
    </label>
    <div id="quick-staff-notif-status" style="font-size:11px;padding:6px 10px;border-radius:6px;margin-top:8px;
      background:${('Notification' in window && Notification.permission==='granted')?'rgba(62,207,142,.1)':'rgba(251,191,36,.1)'};
      color:${('Notification' in window && Notification.permission==='granted')?'var(--green)':'var(--amber)'}">
      ${('Notification' in window && Notification.permission==='granted')
        ? '🔔 نوتیفیکیشن فعال است — در زمان مقرر یادآوری دریافت می‌کنید'
        : '⚠️ برای یادآوری باید اجازه نوتیفیکیشن بدهی'}
    </div>
  `, [
    { label:'ذخیره سریع', cls:'btn-primary', action:`_saveQuickStaffChecklist('${staff.id}')` },
    { label:'فرم کامل', cls:'btn-ghost', action:`closeModal();_openAddTodoForStaff('${staff.id}')` },
    { label:'انصراف', cls:'btn-ghost', action:'closeModal()' },
  ]);
  setTimeout(() => { initDatePickers(); document.getElementById('quick-staff-titles')?.focus(); }, 50);
}


async function _saveQuickStaffChecklist(staffId) {
  _todosInit();
  const staff = (_db.staff || []).find(s => staffIsPersonnel(s) && String(s.id) === String(staffId));
  if (!staff) { showToast('پرسنل پیدا نشد', 'error'); return; }
  if (!_todoCanCreateForStaff(staffId)) { showToast('برای ساخت این چک‌لیست دسترسی نداری', 'error'); return; }
  const rawTitles = (document.getElementById('quick-staff-titles')?.value || '')
    .split(/\r?\n/)
    .map(x => x.trim())
    .filter(Boolean);
  const titleSeen = new Set();
  const duplicateInputCount = rawTitles.length;
  const titles = rawTitles.filter(title => {
    const key = _todoNormalizedTitle(title);
    if (!key || titleSeen.has(key)) return false;
    titleSeen.add(key);
    return true;
  });
  if (!titles.length) { showToast('حداقل یک عنوان وارد کن', 'error'); return; }
  const dateJalali = document.getElementById('quick-staff-date')?.value.trim() || _todayJalaliStr();
  const time = document.getElementById('quick-staff-time')?.value || '';
  const remindMin = parseInt(document.getElementById('quick-staff-remind')?.value || '0');
  const repeat = document.getElementById('quick-staff-repeat')?.value || 'none';
  if (remindMin > 0 && !time) {
    showToast('برای یادآوری باید ساعت انجام را وارد کنی', 'error');
    return;
  }
  if (remindMin > 0 && !(await _ensureReminderPushEnabled('quick-staff-notif-status'))) return;
  const priority = 'urgent';
  const requiresReport = document.getElementById('quick-staff-report')?.checked ? 'required' : 'none';
  const now = new Date().toISOString();
  const existingKeys = new Set((_db.todos || []).map(_todoDuplicateKey).filter(Boolean));
  let skipped = duplicateInputCount - titles.length;
  let created = 0;
  titles.forEach(title => {
    const duplicateKey = [String(staff.id), dateJalali, _todoNormalizedTitle(title)].join('|');
    if (existingKeys.has(duplicateKey)) { skipped++; return; }
    const id = _allocateTodoId();
    existingKeys.add(duplicateKey);
    created++;
    _db.todos.push({
      id, title, note:'', manager_note:'',
      assignee_id: staff.id,
      assignee_email: staff.email || '',
      visibility:'assignee',
      shared_with: [],
      requires_report: requiresReport,
      requires_attachment:'none',
      requires_approval:false,
      owner_id: _todoActiveOwnerId() || 'local-owner',
      created_by: _sbUser?.id || 'local-owner',
      created_by_name: _sbUser?.name || '',
      date_jalali: dateJalali,
      scheduled_date: dateJalali,
      scheduledDate: dateJalali,
      time,
      duration_min:0,
      repeat,
      weekdays:'',
      priority,
      category:'clients',
      goal_id:null,
      remind_min:remindMin,
      sync_gcal:false,
      gcal_event_id:null,
      gcal_calendar_id:null,
      done:false,
      done_at:null,
      completedAt:null,
      completed_at:null,
      archived:false,
      status:'pending',
      created_at: now,
      updated_at: now,
    });
    if (remindMin > 0 && time && dateJalali) {
      _scheduleTodoNotification(id, title, dateJalali, time, remindMin);
    }
  });
  if (!created) {
    showToast('همه آیتم‌ها تکراری بودند و چیزی اضافه نشد', 'warning');
    return;
  }
  _save();
  await _syncToServer();
  closeModal();
  showToast(`${fa(created)} کار برای ${_todoStaffName(staff)} ساخته شد${skipped ? `؛ ${fa(skipped)} تکراری اضافه نشد` : ''} ✓`, 'success');
  _todoActiveTab = _todoCanOpenStaffTasksTab() ? 'staff' : 'mine';
  _todoStaffFilter.staffId = String(staff.id);
  renderTodoList();
  setTimeout(_renderTodoStaffFilteredList, 30);
}


function _openQuickStaffChecklistFromFilter() {
  if (_todoStaffFilter.staffId && _todoStaffFilter.staffId !== 'all') {
    _openQuickStaffChecklist(_todoStaffFilter.staffId);
    return;
  }
  const rows = (_db.staff || []).filter(s => staffIsPersonnel(s) && s.is_active !== false && s.is_active !== 0);
  if (!rows.length) { showToast('اول یک پرسنل اضافه کن', 'error'); return; }
  openModal('انتخاب پرسنل', `
    <div class="form-group full">
      <label class="form-label">برای چه کسی چک‌لیست بسازم؟</label>
      <select class="form-input" id="quick-staff-pick">
        ${rows.map(s => `<option value="${s.id}">${escapeHtml(_todoStaffName(s))}</option>`).join('')}
      </select>
    </div>
  `, [
    { label:'ادامه', cls:'btn-primary', action:`const v=document.getElementById('quick-staff-pick')?.value;closeModal();_openQuickStaffChecklist(v)` },
    { label:'انصراف', cls:'btn-ghost', action:'closeModal()' },
  ]);
}


function _todoFormSections() {
  const byId = id => document.getElementById(id);
  const titleGroup = byId('todo-title')?.closest('.form-group');
  const accessGroup = byId('todo-assignee')?.closest('.form-group');
  const noteGroup = byId('todo-note')?.closest('.form-group');
  const mainTodayGroup = byId('todo-main-today-rank')?.closest('.form-group');
  const dateGroup = byId('todo-date')?.closest('.form-group');
  const timeGroup = byId('todo-time')?.closest('.form-group');
  const durationGroup = byId('todo-duration')?.closest('.form-group');
  const priorityGroup = byId('todo-priority')?.closest('div[style*="margin-bottom"]');
  const categoryGroup = byId('todo-category')?.closest('.form-group');
  const goalGroup = byId('todo-goal')?.closest('.form-group');
  const repeatGroup = byId('todo-repeat')?.closest('.form-group');
  const remindGroup = byId('todo-remind')?.closest('.form-group');
  const gcalGroup = byId('todo-gcal')?.closest('.form-group');
  return {
    quick: [
      titleGroup,
      dateGroup,
      timeGroup,
      durationGroup,
      repeatGroup,
      byId('weekdays-picker'),
      remindGroup,
      byId('notif-status'),
      gcalGroup,
    ],
    details: [
      noteGroup,
      accessGroup,
      mainTodayGroup,
      priorityGroup,
      categoryGroup,
      goalGroup,
    ],
  };
}


function _setTodoFormTab(tab) {
  document.querySelectorAll('.todo-form-tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  const sections = _todoFormSections();
  const all = new Set();
  Object.values(sections).flat().filter(Boolean).forEach(el => all.add(el));
  all.forEach(el => { el.style.display = 'none'; });
  (sections[tab] || sections.quick).filter(Boolean).forEach(el => { el.style.display = ''; });
  if (tab === 'quick') {
    _onTodoRepeatChange(document.getElementById('todo-repeat')?.value || 'none');
  } else {
    const weekdays = document.getElementById('weekdays-picker');
    if (weekdays) weekdays.style.display = 'none';
  }
}


function _initTodoFormTabs() {
  const title = document.getElementById('todo-title');
  if (!title || document.getElementById('todo-form-tabs')) return;
  const noteGroup = document.getElementById('todo-note')?.closest('.form-group');
  const tabs = document.createElement('div');
  tabs.id = 'todo-form-tabs';
  tabs.className = 'todo-form-tabs';
  tabs.innerHTML = `
    <button type="button" class="active" data-tab="quick" onclick="_setTodoFormTab('quick')">سریع</button>
    <button type="button" data-tab="details" onclick="_setTodoFormTab('details')">جزئیات</button>
  `;
  (noteGroup || title.closest('.form-group'))?.before(tabs);
  _setTodoFormTab('quick');
}


function _todoRangeBounds(range, from, to) {
  const today = _todayJalaliStr();
  const [jy,jm,jd] = _jalaliParse(today);
  if (range === 'today') return { from: today, to: today };
  if (range === 'week') {
    const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
    const dow = new Date(gy,gm-1,gd).getDay();
    const daysFromSaturday = (dow + 1) % 7;
    const start = _addDays(jy,jm,jd,-daysFromSaturday);
    const end = _addDays(start[0],start[1],start[2],6);
    return { from:_formatJalali(...start), to:_formatJalali(...end) };
  }
  if (range === 'month') return { from:_formatJalali(jy,jm,1), to:_formatJalali(jy,jm,jm <= 6 ? 31 : jm <= 11 ? 30 : 29) };
  if (range === 'year') return { from:_formatJalali(jy,1,1), to:_formatJalali(jy,12,29) };
  return { from: from || today, to: to || today };
}


function _todoInRange(t, range, from, to) {
  const b = _todoRangeBounds(range, from, to);
  const key = _jalaliKey(_todoScheduledDate(t) || t.date_jalali || b.from);
  return key >= _jalaliKey(b.from) && key <= _jalaliKey(b.to);
}


function _todoPerf(tasks) {
  const todayKey = _jalaliToday();
  const planned = tasks.length;
  const done = tasks.filter(t => t.done).length;
  const overdue = tasks.filter(t => !t.done && _todoScheduledDate(t) && _jalaliKey(_todoScheduledDate(t)) < todayKey).length;
  const late = tasks.filter(t => t.done && _todoScheduledDate(t) && _todoDoneDayKey(t) > _jalaliKey(_todoScheduledDate(t))).length;
  const onTime = done - late;
  const activeDays = new Set(tasks
    .filter(t => t.done_at || t.completed_at)
    .map(t => _jalaliFromInstant(t.done_at || t.completed_at))
    .filter(Boolean)
    .map(parts => _formatJalali(...parts))).size;
  return {
    planned, done, pending: Math.max(0, planned - done), overdue, late,
    percent: planned ? Math.round(done / planned * 100) : 0,
    onTimePercent: done ? Math.round(onTime / done * 100) : 0,
    activeDays
  };
}


function _todoPerfCards(p) {
  const card = (label, value, color='var(--text)') => `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px"><div style="font-size:10px;color:var(--text3);margin-bottom:5px">${label}</div><div style="font-size:18px;font-weight:900;color:${color}">${fa(value)}</div></div>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:10px 0">${[
    card('برنامه‌ریزی‌شده', p.planned, '#60a5fa'),
    card('انجام‌شده', p.done, 'var(--green)'),
    card('انجام‌نشده', p.pending, 'var(--amber)'),
    card('عقب‌افتاده', p.overdue, 'var(--red)'),
    card('با تأخیر', p.late, '#f97316'),
    card('درصد انجام', p.percent + '٪', 'var(--accent2)'),
    card('به‌موقع', p.onTimePercent + '٪', 'var(--green)'),
    card('روزهای فعال', p.activeDays, '#f472b6')
  ].join('')}</div>`;
}


function _todoStaffDashboardHtml() {
  const today = _todayJalaliStr();
  const todayKey = _jalaliKey(today);
  const staff = (_db.staff || []).filter(s => staffIsPersonnel(s) && s.is_active !== false && s.is_active !== 0);
  const tasks = (_db.todos || []).filter(t => _todoCanView(t) && (t.assignee_id || t.staff_id || t.assignee_email));
  const rows = staff.map(s => {
    const mine = tasks.filter(t => String(t.assignee_id || t.staff_id) === String(s.id));
    const todayTasks = mine.filter(t => _todoScheduledDate(t) && _jalaliKey(_todoScheduledDate(t)) === todayKey);
    const done = todayTasks.filter(t => t.done).length;
    const overdue = mine.filter(t => !t.done && _todoScheduledDate(t) && _jalaliKey(_todoScheduledDate(t)) < todayKey).length;
    const last = mine.map(t => t.updated_at || t.done_at || t.created_at).filter(Boolean).sort().pop();
    const progress = todayTasks.length ? Math.round(done / todayTasks.length * 100) : 0;
    return `<div style="text-align:right;border:1px solid var(--border);background:var(--bg2);border-radius:10px;padding:12px;color:var(--text);font-family:var(--font)">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">${_todoStaffAvatar(s)}<div style="min-width:0;flex:1"><div style="font-size:13px;font-weight:900">${escapeHtml(_todoStaffName(s))}</div><div style="font-size:11px;color:var(--text3)">${escapeHtml(s.role || 'پرسنل')}</div></div><div style="font-size:19px;font-weight:900;color:var(--accent2)">${fa(progress)}٪</div></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:10px;color:var(--text3)">
        <span>امروز: <b style="color:var(--text)">${fa(todayTasks.length)}</b></span><span>انجام: <b style="color:var(--green)">${fa(done)}</b></span><span>مانده: <b style="color:var(--amber)">${fa(Math.max(0,todayTasks.length-done))}</b></span><span>عقب: <b style="color:var(--red)">${fa(overdue)}</b></span>
      </div>
      <div style="margin-top:8px;height:6px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden"><div style="height:100%;width:${progress}%;background:var(--accent2)"></div></div>
      <div style="font-size:10px;color:var(--text3);margin-top:8px">آخرین فعالیت: ${last ? new Date(last).toLocaleString('fa-IR') : '—'}</div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
        ${_todoCanCreateForStaff(s.id) ? `<button class="btn btn-primary btn-sm" onclick="_openQuickStaffChecklist('${s.id}')">+ سریع</button><button class="btn btn-ghost btn-sm" onclick="_openAddTodoForStaff('${s.id}')">فرم کامل</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="_openStaffInstructions('${s.id}')">دستورالعمل‌ها</button>
        <button class="btn btn-ghost btn-sm" onclick="_openStaffTodoReport('${s.id}')">گزارش عملکرد</button>
      </div>
    </div>`;
  }).join('');
  return `${_todoTabsHtml()}<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
    <button class="btn btn-primary btn-sm" onclick="openAddPersonnelFromTodo()">+ افزودن پرسنل</button>
    <button class="btn btn-primary btn-sm" onclick="_openQuickStaffChecklistFromFilter()">+ چک‌لیست سریع</button>
    <select class="form-input" style="max-width:180px" onchange="_tpTodoStaffField('staffId',this)">${_todoStaffOptions(_todoStaffFilter.staffId)}</select>
    <select class="form-input" style="max-width:150px" onchange="_tpTodoStaffField('range',this)"><option value="today">امروز</option><option value="week">هفته</option><option value="month">ماه</option><option value="year">سال</option><option value="custom">دلخواه</option></select>
    <select class="form-input" style="max-width:150px" onchange="_tpTodoStaffField('status',this)"><option value="all">همه وضعیت‌ها</option><option value="done">انجام‌شده</option><option value="open">انجام‌نشده</option><option value="overdue">عقب‌افتاده</option></select>
  </div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:12px">${rows || '<div style="color:var(--text3);font-size:13px">پرسنلی ثبت نشده است.</div>'}</div><div id="todo-staff-filtered-list"></div>`;
}


function _todoStaffOverdueNoticeHtml(todayKey) {
  if (_isTeamGuest()) return '';
  const overdue = (_db.todos || [])
    .filter(t => _todoCanView(t) && !t.archived && !t.done && _todoIsStaffAssignedTask(t))
    .filter(t => _todoIsOverdue(t, todayKey));
  if (!overdue.length) return '';

  const grouped = new Map();
  overdue.forEach(t => {
    const key = String(t.assignee_id || t.staff_id || t.assignee_email || 'unknown');
    const label = _todoAssigneeLabel(t) || 'پرسنل بدون نام';
    const current = grouped.get(key) || { label, count: 0 };
    current.count++;
    grouped.set(key, current);
  });

  const rows = [...grouped.values()]
    .sort((a,b) => b.count - a.count || a.label.localeCompare(b.label))
    .map(x => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border-radius:8px;background:rgba(239,68,68,.055);border:1px solid rgba(239,68,68,.16)">
        <span style="font-size:12px;color:var(--text);font-weight:800">${escapeHtml(x.label)} کار عقب‌افتاده دارد</span>
        <span style="font-size:11px;color:var(--red);font-weight:900">${fa(x.count)} کار</span>
      </div>
    `).join('');

  return `
    <div style="margin:14px 0 12px;padding:10px;border-radius:12px;border:1px solid rgba(239,68,68,.28);background:rgba(239,68,68,.07)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;flex-wrap:wrap">
        <div style="font-size:13px;font-weight:900;color:var(--red)">🚨 هشدار کارهای عقب‌افتاده پرسنل</div>
        <button class="btn btn-ghost btn-sm" onclick="_setTodoTab('staff')">مشاهده کارهای پرسنل</button>
      </div>
      <div style="display:grid;gap:6px">${rows}</div>
    </div>`;
}


function _todoStaffDoneToday(t, todayKey = _jalaliToday()) {
  return !!t?.done && _todoIsDoneToday(t, todayKey);
}


function _todoStaffDoneUniqueKey(t) {
  const root = String(_todoRootId(t) || t?.id || '');
  const date = _todoScheduledDate(t) || '';
  const assignee = String(t?.assignee_id || t?.staff_id || t?.assignee_email || '').trim().toLowerCase();
  const title = _todoNormalizedTitle(t?.title);
  return [root, date, assignee, title].join('|');
}


function _uniqueTodoStaffDoneItems(items) {
  const seen = new Set();
  return (items || []).filter(t => {
    const key = _todoStaffDoneUniqueKey(t);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}


function _todoStaffTaskRow(t, todayKey = _jalaliToday()) {
  const scheduled = _todoScheduledDate(t);
  const scheduledKey = scheduled ? _jalaliKey(scheduled) : 0;
  const isOverdue = !t.done && scheduledKey && scheduledKey < todayKey;
  const doneToday = _todoStaffDoneToday(t, todayKey);
  const canEdit = _todoCanEdit(t);
  const canDelete = _todoCanDelete(t);
  const todoMenuId = `staff-todo-menu-${t.id}`;
  const deleteMenuItem = canDelete
    ? `<div class="row-menu-item" style="color:var(--red)" onclick="_deleteStaffTodoCompletely(${t.id})">🗑 حذف کامل</div>`
    : '';
  const priority = t.priority || 'medium';
  const priorityText = ({low:'پایین', medium:'متوسط', high:'بالا', urgent:'فوری'})[priority] || 'متوسط';
  const priorityColor = ({low:'var(--text3)', medium:'#60a5fa', high:'var(--amber)', urgent:'var(--red)'})[priority] || '#60a5fa';
  const borderColor = t.done ? 'rgba(62,207,142,.34)' : (isOverdue ? 'rgba(239,68,68,.45)' : 'var(--border)');
  const bg = t.done ? 'rgba(62,207,142,.07)' : (isOverdue ? 'rgba(239,68,68,.07)' : 'var(--bg2)');
  const dateLabel = scheduled ? DateService.disp(scheduled) : 'بدون تاریخ';
  const timeLabel = _todoTimeRangeLabel(t);
  return `<div data-todo-id="${t.id}" class="todo-row" style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid ${borderColor};border-radius:10px;background:${bg};margin-bottom:7px;opacity:${t.done ? .78 : 1}">
    <button data-todo-complete onpointerdown="_todoCompletePointerDown(event,${t.id})" onpointerup="_todoCompletePointerUp(event,${t.id})" onpointercancel="_todoCompletePointerCancel(event)" onclick="_todoCompleteClick(event,${t.id})" aria-pressed="${t.done ? 'true' : 'false'}" title="${t.done?'برداشتن تیک':'تیک انجام'}"
      style="width:24px;height:24px;border-radius:50%;flex-shrink:0;margin-top:1px;cursor:pointer;border:2px solid ${t.done?'var(--green)':isOverdue?'var(--red)':'var(--border2)'};background:${t.done?'var(--green)':'transparent'};color:white;font-size:12px;font-weight:900;line-height:1">
      ${t.done?'✓':''}
    </button>
    <div style="flex:1;min-width:0;cursor:pointer" onclick="${canEdit ? `openEditTodo(${t.id})` : `_openTodoReadonly(${t.id})`}">
      <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
        <span data-todo-title style="font-size:13px;font-weight:${t.done?'600':'900'};color:${t.done?'var(--text2)':'var(--text)'};text-decoration:${t.done?'line-through':'none'}">${escapeHtml(t.title || 'بدون عنوان')}</span>
        ${isOverdue ? '<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(239,68,68,.14);color:var(--red);font-weight:800">عقب‌افتاده</span>' : ''}
        ${doneToday ? '<span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(62,207,142,.12);color:var(--green);font-weight:800">انجام‌شده امروز</span>' : ''}
        <span style="font-size:10px;padding:2px 7px;border-radius:5px;background:rgba(96,165,250,.09);color:${priorityColor};font-weight:800">${priorityText}</span>
      </div>
      ${t.note ? `<div style="font-size:11px;color:var(--text3);line-height:1.6;margin-top:4px">${escapeHtml(String(t.note).slice(0,90))}${String(t.note).length>90?'…':''}</div>` : ''}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:11px;color:var(--text3)">
        <span>${escapeHtml(_todoAssigneeLabel(t) || 'پرسنل')}</span>
        <span>📅 ${escapeHtml(dateLabel)}</span>
        ${timeLabel ? `<span>⏰ ${escapeHtml(timeLabel)}</span>` : ''}
        ${t.done_at ? `<span>✓ ${new Date(t.done_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}</span>` : ''}
      </div>
    </div>
    <div class="row-menu" onclick="event.stopPropagation()">
      <button class="row-menu-btn todo-overdue-menu-btn" onclick="toggleRowMenu(event,'${todoMenuId}')" aria-label="عملیات کار">⋮</button>
      <div class="row-menu-panel" id="${todoMenuId}">
        <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'move_tomorrow')">↪ ببر به فردا</div>
        <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'move_today')">↩ ببر به امروز</div>
        <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'skip')">⏭ رد کردن این نوبت</div>
        ${deleteMenuItem}
      </div>
    </div>
  </div>`;
}


function _renderTodoStaffFilteredList() {
  const box = document.getElementById('todo-staff-filtered-list');
  if (!box) return;
  const todayKey = _jalaliToday();
  const today = _todayJalaliStr();
  const todayParts = _jalaliParse(today);
  let tomorrowStr = '';
  try {
    const gToday = jalaliToGregorian(todayParts[0], todayParts[1], todayParts[2]);
    const tmDate = new Date(gToday[0], gToday[1]-1, gToday[2]+1);
    const tmJ = gregorianToJalali(tmDate.getFullYear(), tmDate.getMonth()+1, tmDate.getDate());
    tomorrowStr = _formatJalali(tmJ[0], tmJ[1], tmJ[2]);
  } catch(e) {}
  const tomorrowKey = tomorrowStr ? _jalaliKey(tomorrowStr) : 0;
  const todaySnapshots = (_db.todos || []).filter(t => _todoCanView(t) && t.archived && t._snapshot && _todoStaffDoneToday(t, todayKey));
  let list = [...(_db.todos || []).filter(t => _todoCanView(t) && !t.archived), ...todaySnapshots]
    .filter(t => t.assignee_id || t.staff_id || t.assignee_email);
  if (_todoStaffFilter.staffId !== 'all') list = list.filter(t => String(t.assignee_id || t.staff_id) === String(_todoStaffFilter.staffId));
  const todayMode = _todoStaffFilter.range === 'today';
  if (!todayMode) list = list.filter(t => _todoInRange(t, _todoStaffFilter.range, _todoStaffFilter.from, _todoStaffFilter.to));
  const report = _todoStaffReportId ? _todoReportForStaffHtml(_todoStaffReportId) : '';
  const statusAllows = (t) => {
    if (_todoStaffFilter.status === 'done') return !!t.done;
    if (_todoStaffFilter.status === 'open') return !t.done;
    if (_todoStaffFilter.status === 'overdue') return _todoIsOverdue(t, todayKey);
    return true;
  };
  list = list.filter(statusAllows);
  const sortByDateTime = (a,b) => {
    const ak = _jalaliKey(_todoScheduledDate(a) || today);
    const bk = _jalaliKey(_todoScheduledDate(b) || today);
    return ak - bk || _sortByTime(a,b);
  };
  const overdueItems = list.filter(t => _todoIsOverdue(t, todayKey)).sort(sortByDateTime);
  const todayItems = list.filter(t => {
    const scheduled = _todoScheduledDate(t);
    const key = scheduled ? _jalaliKey(scheduled) : 0;
    return !scheduled || key === todayKey;
  }).sort(_sortByTime);
  const todayOpenItems = todayItems.filter(t => !t.done);
  const doneTodayAllItems = _uniqueTodoStaffDoneItems(list.filter(t => _todoStaffDoneToday(t, todayKey)))
    .sort((a,b) => new Date(b.done_at || b.completed_at || 0) - new Date(a.done_at || a.completed_at || 0));
  const lateDoneTodayItems = doneTodayAllItems.filter(t => {
    const scheduled = _todoScheduledDate(t);
    return scheduled && _jalaliKey(scheduled) < todayKey;
  });
  const lateDoneTodayKeys = new Set(lateDoneTodayItems.map(_todoStaffDoneUniqueKey));
  const doneTodayItems = doneTodayAllItems.filter(t => !lateDoneTodayKeys.has(_todoStaffDoneUniqueKey(t)));
  const tomorrowItems = list.filter(t => !t.done && t.date_jalali && tomorrowKey && _jalaliKey(t.date_jalali) === tomorrowKey).sort(_sortByTime);
  const futureItems = list.filter(t => !t.done && t.date_jalali && _jalaliKey(t.date_jalali) > (tomorrowKey || todayKey)).sort(sortByDateTime);
  const noDateItems = list.filter(t => !t.done && !_todoScheduledDate(t)).sort(_sortByTime);
  const openItems = list.filter(t => !t.done).sort(sortByDateTime);
  const oldDoneItems = list.filter(t => t.done && !_todoStaffDoneToday(t, todayKey)).sort((a,b) => new Date(b.done_at || b.completed_at || 0) - new Date(a.done_at || a.completed_at || 0));
  const staffName = _todoStaffFilter.staffId !== 'all'
    ? _todoStaffName((_db.staff || []).find(s => String(s.id) === String(_todoStaffFilter.staffId)) || {})
    : 'همه پرسنل';
  const totalToday = todayItems.length;
  const doneTodayInSchedule = todayItems.filter(t => t.done).length;
  const progress = totalToday ? Math.round(doneTodayInSchedule / totalToday * 100) : 0;
  const statChip = (label, value, color='var(--text)') => `<div style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:9px;padding:8px 10px;min-width:92px">
    <div style="font-size:10px;color:var(--text3);margin-bottom:4px">${label}</div>
    <div style="font-size:17px;font-weight:900;color:${color}">${fa(value)}</div>
  </div>`;
  const overview = `<div style="background:linear-gradient(180deg,rgba(124,106,247,.10),rgba(255,255,255,.02));border:1px solid rgba(124,106,247,.22);border-radius:12px;padding:12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px">
      <div><div style="font-size:14px;font-weight:900;color:var(--text)">نمای کلی کارهای پرسنل</div><div style="font-size:11px;color:var(--text3);margin-top:3px">${escapeHtml(staffName)} · ${DateService.disp(today)}</div></div>
      <div style="font-size:22px;font-weight:900;color:var(--accent2)">${fa(progress)}٪</div>
    </div>
    <div style="height:7px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-bottom:10px"><div style="height:100%;width:${progress}%;background:linear-gradient(90deg,var(--accent2),var(--green))"></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px">
      ${statChip('امروز', totalToday, '#60a5fa')}
      ${statChip('مانده امروز', todayOpenItems.length, 'var(--amber)')}
      ${statChip('انجام امروز', doneTodayAllItems.length, 'var(--green)')}
      ${statChip('عقب‌افتاده', overdueItems.length, 'var(--red)')}
      ${statChip('همه باز', openItems.length, 'var(--text)')}
    </div>
  </div>`;
  const section = (icon, title, count, body, color = 'var(--text)', open = true, note = '') => `<details ${open?'open':''} style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:10px">
    <summary style="list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;color:${color};font-size:13px;font-weight:900">
      <span>${icon} ${title}${note ? ` <small style="font-size:10px;color:var(--text3);font-weight:600">${note}</small>` : ''}</span><span style="font-size:11px;color:var(--text3)">${fa(count)} مورد</span>
    </summary>
    <div style="margin-top:10px">${body || '<div style="font-size:12px;color:var(--text3);text-align:center;padding:14px">موردی در این بخش نیست.</div>'}</div>
  </details>`;
  const rangeTitle = ({today:'امروز', week:'این هفته', month:'این ماه', year:'امسال', custom:'بازه دلخواه'})[_todoStaffFilter.range] || 'این بازه';
  const rangeList = `<div style="margin-bottom:8px;font-size:12px;color:var(--text3);display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <span>چک‌لیست ${escapeHtml(staffName)}</span>
      <span>${fa(openItems.length)} انجام‌نشده · ${fa(doneTodayAllItems.length)} انجام‌شده امروز</span>
    </div>
    ${section('📌', 'کارهای انجام‌نشده', openItems.length, openItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text)', true)}
    ${section('✅', 'انجام‌شده‌های امروز', doneTodayItems.length, doneTodayItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--green)', doneTodayItems.length > 0)}
    ${oldDoneItems.length && _todoStaffFilter.status === 'done' ? section('🗂', 'انجام‌شده‌های قدیمی‌تر', oldDoneItems.length, oldDoneItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text2)', false) : ''}`;
  const todayLayout = `
    ${overdueItems.length ? section('🚨', 'عقب‌افتاده', overdueItems.length, overdueItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--red)', true, 'کارهای قبل از امروز') : ''}
    ${section('☀️', 'امروز', todayOpenItems.length, todayOpenItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text)', true, `${DateService.disp(today)} · ${fa(todayOpenItems.length)} باقی‌مانده`)}
    ${section('✅', 'انجام‌شده‌های امروز', doneTodayItems.length, doneTodayItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--green)', doneTodayItems.length > 0)}
    ${lateDoneTodayItems.length ? section('↩', 'عقب‌افتاده‌های تکمیل‌شده امروز', lateDoneTodayItems.length, lateDoneTodayItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--amber)', false) : ''}
    ${tomorrowItems.length ? section('🌙', 'فردا', tomorrowItems.length, tomorrowItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text2)', false, DateService.disp(tomorrowStr)) : ''}
    ${futureItems.length ? section('📆', 'روزهای بعد', futureItems.length, futureItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text2)', false) : ''}
    ${noDateItems.length ? section('🗂', 'بدون تاریخ', noDateItems.length, noDateItems.map(t => _todoStaffTaskRow(t, todayKey)).join(''), 'var(--text2)', false) : ''}`;
  box.innerHTML = `${report}${overview}${todayMode ? todayLayout : `<div style="font-size:12px;color:var(--text3);margin-bottom:8px">نمای ${rangeTitle}</div>${rangeList}`}`;
}


function _openStaffTodoChecklist(staffId) {
  _todoStaffReportId = '';
  _todoStaffFilter.staffId = String(staffId);
  renderTodoList();
  setTimeout(_renderTodoStaffFilteredList, 20);
}


function _todoReportForStaffHtml(staffId) {
  const staff = (_db.staff || []).find(s => staffIsPersonnel(s) && String(s.id) === String(staffId));
  const list = (_db.todos || [])
    .filter(t => _todoCanView(t) && String(t.assignee_id || '') === String(staffId))
    .filter(t => _todoInRange(t, _todoReportFilter.range, _todoReportFilter.from, _todoReportFilter.to));
  const perf = _todoPerf(list);
  return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:12px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px">
      <div style="font-size:14px;font-weight:900">گزارش عملکرد ${escapeHtml(staff ? _todoStaffName(staff) : 'پرسنل')}</div>
      <select class="form-input" style="max-width:160px" onchange="_tpTodoReportRange(this)">
        <option value="today" ${_todoReportFilter.range==='today'?'selected':''}>روزانه</option>
        <option value="week" ${_todoReportFilter.range==='week'?'selected':''}>هفتگی</option>
        <option value="month" ${_todoReportFilter.range==='month'?'selected':''}>ماهانه</option>
        <option value="year" ${_todoReportFilter.range==='year'?'selected':''}>سالانه</option>
      </select>
    </div>
    ${_todoPerfCards(perf)}
  </div>`;
}


function _todoReportHtml(myOnly = false) {
  let list = (_db.todos || []).filter(t => _todoCanView(t));
  if (myOnly) list = list.filter(t => _todoIsOwnAssigned(t));
  if (!myOnly && _todoReportFilter.staffIds.length) list = list.filter(t => _todoReportFilter.staffIds.includes(String(t.assignee_id)));
  list = list.filter(t => _todoInRange(t, myOnly ? 'month' : _todoReportFilter.range, _todoReportFilter.from, _todoReportFilter.to));
  const perf = _todoPerf(list);
  const byDay = {};
  list.forEach(t => { const d = _todoScheduledDate(t) || 'بدون تاریخ'; (byDay[d] ||= []).push(t); });
  const details = Object.keys(byDay).sort((a,b)=>_jalaliKey(a)-_jalaliKey(b)).map(d => `<details style="border:1px solid var(--border);border-radius:10px;padding:9px;background:var(--bg2);margin-bottom:7px"><summary style="cursor:pointer;font-size:12px;font-weight:800">${DateService.disp(d)} · ${fa(byDay[d].length)} کار</summary><div style="margin-top:8px">${byDay[d].map(t => `<div style="font-size:12px;color:var(--text2);padding:6px 0;border-top:1px solid var(--border)">${t.done?'✅':'○'} ${escapeHtml(t.title)} ${t.staff_report ? `<div style="font-size:11px;color:var(--text3);margin-top:3px">گزارش: ${escapeHtml(t.staff_report)}</div>` : ''}</div>`).join('')}</div></details>`).join('');
  return `${_todoTabsHtml()}${myOnly ? '' : `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px"><select class="form-input" style="max-width:160px" onchange="_tpTodoReportRange(this,'list')"><option value="today">روزانه</option><option value="week" selected>هفتگی</option><option value="month">ماهانه</option><option value="year">سالانه</option><option value="custom">دلخواه</option></select></div>`}${_todoPerfCards(perf)}<div style="height:8px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden;margin-bottom:12px"><div style="height:100%;width:${perf.percent}%;background:linear-gradient(90deg,var(--green),var(--accent2))"></div></div>${details || '<div style="font-size:12px;color:var(--text3);text-align:center;padding:18px">برای این بازه گزارشی وجود ندارد.</div>'}`;
}


function _todoEndTime(time, durationMin) {
  if (!time || !durationMin) return '';
  const parts = String(time).split(':').map(Number);
  if (parts.length < 2 || parts.some(n => !Number.isFinite(n))) return '';
  const total = ((parts[0] * 60 + parts[1] + durationMin) % 1440 + 1440) % 1440;
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}


function _todoDurationLabel(minutes) {
  const n = parseInt(minutes || '0', 10);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 60) return fa(n) + ' دقیقه';
  const h = Math.floor(n / 60);
  const m = n % 60;
  return fa(h) + ' ساعت' + (m ? ' و ' + fa(m) + ' دقیقه' : '');
}


function _setTodoTomorrowExpanded(open) {
  _todoTomorrowExpanded = !!open;
  localStorage.setItem('tp_todo_tomorrow_expanded', _todoTomorrowExpanded ? '1' : '0');
}


function _setTodoFutureExpanded(key, open) {
  _todoFutureExpanded[key] = !!open;
  localStorage.setItem('tp_todo_future_expanded', JSON.stringify(_todoFutureExpanded));
}


function _renderTodoSurface() {
  if (currentPage === 'calendar') renderCalendar();
  else renderTodoList();
}


function _setTodoViewMode(mode) {
  _todoViewMode = mode || 'list';
  localStorage.setItem('tp_todo_view_mode', _todoViewMode);
  _renderTodoSurface();
}


function _cycleTodoCalendarView() {
  const order = ['week','month','year'];
  if (!order.includes(_todoViewMode)) {
    _setTodoViewMode('week');
    return;
  }
  const current = order.includes(_todoViewMode) ? _todoViewMode : 'week';
  const next = order[(order.indexOf(current) + 1) % order.length];
  _setTodoViewMode(next);
}


function _todoCalendarShift(delta) {
  const [jy,jm,jd] = _jalaliParse(_todoCalendarCursor || _todayJalaliStr());
  if (DateService.isGregorian()) {
    const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
    const d = new Date(gy, gm - 1, gd);
    if (_todoViewMode === 'week') d.setDate(d.getDate() + delta * 7);
    else if (_todoViewMode === 'month') d.setMonth(d.getMonth() + delta);
    else if (_todoViewMode === 'year') d.setFullYear(d.getFullYear() + delta);
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    _todoCalendarCursor = _formatJalali(j[0], j[1], j[2]);
  } else if (_todoViewMode === 'week') _todoCalendarCursor = _formatJalali(..._addDays(jy,jm,jd, delta * 7));
  else if (_todoViewMode === 'month') _todoCalendarCursor = _formatJalali(..._addMonths(jy,jm,jd, delta));
  else if (_todoViewMode === 'year') _todoCalendarCursor = _formatJalali(jy + delta, jm, jd);
  _renderTodoSurface();
}


function _todoCalendarToday() {
  _todoCalendarCursor = _todayJalaliStr();
  _renderTodoSurface();
}


function _setTodoCalendarFilter(filter) {
  _todoCalendarFilter = filter || 'all';
  localStorage.setItem('tp_todo_calendar_filter', _todoCalendarFilter);
  _renderTodoSurface();
}


function _setTodoCalendarSearch(value) {
  _todoCalendarSearch = (value || '').trim();
  _todoCalendarSearchOpen = true;
  clearTimeout(_todoCalendarSearchTimer);
  const pos = document.getElementById('todo-calendar-search')?.selectionStart ?? _todoCalendarSearch.length;
  _todoCalendarSearchTimer = setTimeout(() => {
    _renderTodoSurface();
    setTimeout(() => {
      const input = document.getElementById('todo-calendar-search');
      if (input) { input.focus(); input.setSelectionRange(pos, pos); }
    }, 0);
  }, 320);
}


function _openTodoCalendarSearch() {
  if (_todoCalendarSearchOpen) return;
  _todoCalendarSearchOpen = true;
  _renderTodoSurface();
  setTimeout(() => document.getElementById('todo-calendar-search')?.focus(), 0);
}


function _toggleTodoCalendarSearch(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const nextOpen = !_todoCalendarSearchOpen;
  _todoCalendarSearchOpen = nextOpen;
  if (!nextOpen) document.getElementById('todo-calendar-search')?.blur();
  _renderTodoSurface();
  if (nextOpen) {
    setTimeout(() => document.getElementById('todo-calendar-search')?.focus(), 0);
  }
  return false;
}


function _maybeCloseTodoCalendarSearch() {
  if ((_todoCalendarSearch || '').trim()) return;
  _todoCalendarSearchOpen = false;
  setTimeout(_renderTodoSurface, 120);
}


function _toggleTodoCalendarRepeats(checked) {
  _todoCalendarShowRepeats = !!checked;
  localStorage.setItem('tp_todo_calendar_show_repeats', _todoCalendarShowRepeats ? '1' : '0');
  _renderTodoSurface();
}


function _toggleTodoCalendarHolidays(checked) {
  _todoCalendarShowHolidays = !!checked;
  localStorage.setItem('tp_todo_calendar_show_holidays', _todoCalendarShowHolidays ? '1' : '0');
  _renderTodoSurface();
}


function _selectTodoCalendarDay(date) {
  _todoCalendarSelectedDate = date || _todayJalaliStr();
  localStorage.setItem('tp_todo_calendar_selected_date', _todoCalendarSelectedDate);
  _renderTodoSurface();
}


function _openTodoWeekFromDate(date) {
  _todoCalendarSelectedDate = date || _todayJalaliStr();
  _todoCalendarCursor = _todoCalendarSelectedDate;
  _todoViewMode = 'week';
  localStorage.setItem('tp_todo_calendar_selected_date', _todoCalendarSelectedDate);
  localStorage.setItem('tp_todo_view_mode', _todoViewMode);
  _renderTodoSurface();
}


function _todoViewSwitcherHtml() {
  if (['open','sessions','habits'].includes(_todoCalendarFilter)) {
    _todoCalendarFilter = 'all';
    localStorage.setItem('tp_todo_calendar_filter', _todoCalendarFilter);
  }
  const viewValue = ['list','week','month','year'].includes(_todoViewMode) ? _todoViewMode : 'list';
  const viewSelect = `
    <label class="todo-overview-select" title="انتخاب نمای لیست کارها">
      <span>نمای کلی</span>
      <select onchange="_setTodoViewMode(this.value)" aria-label="نمای کلی لیست کارها">
        <option value="list" ${viewValue==='list'?'selected':''}>لیست کارها</option>
        <option value="week" ${viewValue==='week'?'selected':''}>هفته</option>
        <option value="month" ${viewValue==='month'?'selected':''}>ماه</option>
        <option value="year" ${viewValue==='year'?'selected':''}>سال</option>
      </select>
    </label>
  `;
  const navName = _todoViewMode === 'month' ? 'ماه' : _todoViewMode === 'year' ? 'سال' : 'هفته';
  return `<div class="todo-calendar-toolbar">
    <div class="todo-calendar-toolbar-row">
      <div class="todo-calendar-mode-row">${viewSelect}</div>
    </div>
    ${_todoViewMode !== 'list' ? `<div class="todo-calendar-search-row">
      <div class="todo-calendar-search-box ${(_todoCalendarSearchOpen || _todoCalendarSearch) ? 'open' : ''}">
        <button type="button" class="btn btn-ghost btn-sm todo-calendar-search-trigger ${_todoCalendarSearch ? 'active' : ''}" onpointerdown="event.preventDefault();_toggleTodoCalendarSearch(event)" onclick="return false" title="جستجو" aria-label="جستجو">🔍</button>
        <input class="input" id="todo-calendar-search" value="${escapeHtml(_todoCalendarSearch)}" onfocus="_openTodoCalendarSearch()" onblur="_maybeCloseTodoCalendarSearch()" oninput="_setTodoCalendarSearch(this.value)" placeholder="جستجوی سریع..." style="min-width:220px;max-width:360px;height:38px">
        ${_todoCalendarSearchResultsHtml()}
      </div>
      <label class="todo-calendar-repeat-toggle" style="display:flex;align-items:center;gap:6px;color:var(--text2);font-size:12px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:8px 10px">
        <input type="checkbox" ${_todoCalendarShowRepeats?'checked':''} onchange="_toggleTodoCalendarRepeats(this.checked)">
        نمایش تکرارهای آینده
      </label>
      ${_todoCalendarDataFilterChipsHtml()}
    </div>` : ''}
  </div>`;
}


function _todoStickyAddBoxHtml(stats = {}) {
  _todosInit();
  const today = _todayJalaliStr();
  const todayKey = _jalaliKey(today);
  const todos = (_db.todos || []).filter(t => !t.archived);
  const todayCount = stats.todayCount ?? todos.filter(t => !t.date_jalali || _jalaliKey(t.date_jalali) === todayKey).length;
  const doneCnt = stats.doneCnt ?? todos.filter(t => t.done && t.date_jalali && _jalaliKey(t.date_jalali) === todayKey).length;
  const totalToday = stats.totalToday ?? todayCount;
  const progress = stats.progress ?? (totalToday ? Math.round(doneCnt / totalToday * 100) : 0);
  return `<div class="todo-sticky-add-box" style="position:sticky;top:0;z-index:30;background:transparent;border:none;border-radius:0;padding:0;margin-bottom:14px;box-shadow:none">
    <button class="tp-cta" onclick="openAddTodo()"
      style="width:100%;padding:14px 20px;border-radius:14px;border:none;cursor:pointer;
        font-family:var(--font);font-size:15px;font-weight:700;
        background:linear-gradient(135deg,#7c6af7,#5b4de0);
        color:white;letter-spacing:.01em;
        box-shadow:0 4px 20px rgba(124,106,247,.4);
        display:flex;align-items:center;justify-content:center;gap:10px">
      <span>کار جدید اضافه کن</span>
      <span style="width:28px;height:28px;border-radius:8px;background:rgba(255,255,255,.2);
        display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">+</span>
    </button>
    ${totalToday > 0 ? `
    <div style="margin-top:12px;display:flex;align-items:center;gap:12px">
      <div style="flex:1">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:6px">
          <span>پیشرفت امروز</span>
          <span>${fa(doneCnt)}/${fa(totalToday)} کار</span>
        </div>
        <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${progress}%;background:${progress===100?'var(--green)':'var(--accent)'};border-radius:3px;transition:width .4s"></div>
        </div>
      </div>
      <div style="font-size:18px;font-weight:800;color:${progress===100?'var(--green)':'var(--accent)'}">${progress}٪</div>
    </div>` : ''}
  </div>`;
}


function _todoCalendarTasksSignature() {
  return JSON.stringify({
    repeats: _todoCalendarShowRepeats ? 1 : 0,
    scope: _isTeamGuest() ? 'guest' : 'owner-mine',
    todos: (_db.todos || []).map(t => [
      t.id, t.date_jalali, t.scheduled_date, t.time, t.repeat, t.weekdays,
      t.done ? 1 : 0, t.archived ? 1 : 0, t.assignee_id || '', t.staff_id || '', t.assignee_email || '', t.status || '', t.updated_at || '', t.done_at || ''
    ])
  });
}


function _todoTasksForCalendar() {
  _todosInit();
  const sig = _todoCalendarTasksSignature();
  if (_todoCalendarTasksCache.sig === sig) return _todoCalendarTasksCache.items;
  const base = (_db.todos || [])
    .filter(t => _todoCanView(t) && _todoIsMineScope(t) && !t.archived && t.date_jalali)
    .map(t => ({ ...t, _key: _jalaliKey(t.date_jalali) }))
    .sort((a,b) => a._key - b._key || (a.time||'').localeCompare(b.time||''));
  if (!_todoCalendarShowRepeats) {
    _todoCalendarTasksCache = { sig, items: base };
    return base;
  }
  const out = [...base];
  const seen = new Set(base.map(t => `${t.id}:${t.date_jalali}`));
  base.filter(t => !t.done && t.repeat && t.repeat !== 'none').forEach(t => {
    let cursor = { ...t };
    for (let i = 0; i < 370; i++) {
      const nextDate = _calcNextRepeatDate(cursor);
      if (!nextDate) break;
      const key = `${t.id}:${nextDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ ...t, id:t.id, date_jalali:nextDate, _key:_jalaliKey(nextDate), _repeatPreview:true });
      }
      cursor = { ...cursor, date_jalali: nextDate };
    }
  });
  const items = out.sort((a,b) => a._key - b._key || (a.time||'').localeCompare(b.time||''));
  _todoCalendarTasksCache = { sig, items };
  return items;
}


function _todoCalendarHeat(list) {
  const count = list.length;
  if (count > 8) return { bg:'rgba(239,68,68,.16)', border:'rgba(239,68,68,.55)', label:'سنگین' };
  if (count >= 6) return { bg:'rgba(249,115,22,.14)', border:'rgba(249,115,22,.48)', label:'شلوغ' };
  if (count >= 3) return { bg:'rgba(245,158,11,.13)', border:'rgba(245,158,11,.42)', label:'متوسط' };
  if (count >= 1) return { bg:'rgba(34,197,94,.12)', border:'rgba(34,197,94,.38)', label:'سبک' };
  return { bg:'var(--bg2)', border:'var(--border)', label:'خالی' };
}


function _todoDayTimeStats(list) {
  const sessions = list.filter(t => _todoCategoryMeta(t).kind === 'sessions').length;
  const deep = list.filter(t => ['education','goals'].includes(_todoCategoryMeta(t).kind) || t.priority === 'high').length;
  const work = Math.max(0, list.length - sessions - deep);
  const sessionHours = sessions;
  const deepHours = deep;
  const workHours = Math.max(0, Math.round(work * .75));
  const busy = sessionHours + deepHours + workHours;
  const free = Math.max(0, 8 - busy);
  return { free, sessionHours, deepHours, workHours, busy };
}


function _todoBirthdayIndex() {
  const students = _db.students || [];
  const sig = students.map(s => [s.id, s.name, s.lname, s.birth_jalali, s.birthday_jalali, s.birth_date, s.birthday].join('|')).join('~');
  if (_todoBirthdayIndexCache.sig === sig) return _todoBirthdayIndexCache.map;
  const map = new Map();
  students.forEach(s => {
    const raw = s.birth_jalali || s.birthday_jalali || s.birth_date || s.birthday || '';
    if (!raw) return;
    const [,sm,sd] = _jalaliParse(raw);
    const key = `${sm}/${sd}`;
    const name = `${s.name || ''} ${s.lname || ''}`.trim();
    if (!name) return;
    const arr = map.get(key) || [];
    arr.push({ id:s.id, name });
    map.set(key, arr);
  });
  _todoBirthdayIndexCache = { sig, map };
  return map;
}


function _todoCalendarBirthdays(date, force = false) {
  if (!_db.students || (!force && !_todoCalendarFilterActive('birthdays')) || !_todoOccasionCategoryEnabled('birthdays')) return [];
  const [,m,d] = _jalaliParse(date);
  const list = _todoBirthdayIndex().get(`${m}/${d}`) || [];
  const q = (_todoCalendarSearch || '').trim().toLowerCase();
  return q ? list.filter(x => (x.name || '').toLowerCase().includes(q)) : list;
}


function _todoCalendarSearchResultsHtml() {
  const q = (_todoCalendarSearch || '').trim().toLowerCase();
  if (!q) return '';
  const results = [];
  const add = (type, icon, title, subtitle, action) => {
    if (`${title || ''} ${subtitle || ''}`.toLowerCase().includes(q)) results.push({type,icon,title,subtitle,action});
  };
  (_db.todos || []).filter(t => !t.archived).forEach(t => add('task',_todoCategoryMeta(t).icon,t.title || 'کار',DateService.disp(t.date_jalali || ''),`openEditTodo(${Number(t.id)})`));
  (_db.sessions || []).forEach(s => add('session','👥',s.title || s.subject || (META.sessionSingular || 'جلسه'),DateService.disp(s.date_jalali || ''),`openSessionDetail(${Number(s.id)})`));
  (_db.habits || []).filter(h => !h.archived).forEach(h => add('habit',h.icon || '🔥',h.title || 'عادت',h.desc || '',`openHabitDetail(${Number(h.id)})`));
  (_db.todo_calendar_events || []).forEach(e => add('occasion',_todoEventTypeMeta(e.type).icon,e.title || 'مناسبت',DateService.disp(e.date_jalali || ''),`_openTodoDayPopover('${e.date_jalali}')`));
  (_db.reminders || []).filter(r => !r.done).forEach(r => {
    const date = r.due_date_jalali || r.due_date || r.date_jalali || '';
    add('reminder','🔔',r.title || 'یادآوری',DateService.disp(date),`_openTodoDayPopover('${date}')`);
  });
  (_db.key_events || []).forEach(e => add('key_event','⭐',(e.text || '').replace(/<[^>]*>/g,' '),`رویداد مهم · ${DateService.disp(e.date_jalali || e.remind_date || '')}`,`_openTodoDayPopover('${e.date_jalali || e.remind_date || ''}')`));
  (_db.students || []).forEach(s => {
    const raw = s.birth_jalali || s.birthday_jalali || s.birth_date || s.birthday || '';
    if (!raw) return;
    const [,m,d] = _jalaliParse(raw);
    const [y] = _jalaliParse(_todoCalendarCursor || _todayJalaliStr());
    const date = _formatJalali(y,m,d);
    add('birthday','🎂',`${s.name || ''} ${s.lname || ''}`.trim(),`تولد · ${DateService.disp(date)}`,`_openTodoDayPopover('${date}')`);
  });
  Object.entries(_db.todo_day_notes || {}).forEach(([date,note]) => add('note','📝',note,`یادداشت روز · ${DateService.disp(date)}`,`_openTodoDayPopover('${date}')`));
  const shown = results.slice(0,14);
  return `<div class="calendar-search-results">
    ${shown.map(r => `<button type="button" class="calendar-search-result" onclick="${r.action}">
      <span style="font-size:16px">${escapeHtml(r.icon)}</span>
      <span style="min-width:0;flex:1"><b style="display:block;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.title)}</b><small style="color:var(--text3)">${escapeHtml(r.subtitle || '')}</small></span>
    </button>`).join('') || '<div style="padding:18px;text-align:center;font-size:12px;color:var(--text3)">نتیجه‌ای پیدا نشد.</div>'}
    ${results.length > shown.length ? `<div style="padding:6px;text-align:center;font-size:10px;color:var(--text3)">و ${fa(results.length-shown.length)} نتیجه دیگر؛ عبارت دقیق‌تری بنویسید.</div>` : ''}
  </div>`;
}


const _IRAN_SOLAR_OCCASIONS = {
  '1/1':[['نوروز','official']], '1/2':[['عید نوروز','official']], '1/3':[['عید نوروز','official']],
  '1/4':[['عید نوروز','official']], '1/6':[['زادروز زرتشت','national']],
  '1/12':[['روز جمهوری اسلامی ایران','official']], '1/13':[['روز طبیعت','official']],
  '1/20':[['روز ملی فناوری هسته‌ای','national']], '1/25':[['روز بزرگداشت عطار نیشابوری','national']],
  '2/1':[['روز بزرگداشت سعدی','national']], '2/2':[['تأسیس سپاه پاسداران','national']],
  '2/10':[['روز ملی خلیج فارس','national']], '2/12':[['روز معلم','national']],
  '2/25':[['روز پاسداشت زبان فارسی و بزرگداشت فردوسی','national']],
  '3/1':[['روز بزرگداشت ملاصدرا','national']], '3/3':[['فتح خرمشهر','national']],
  '3/14':[['رحلت امام خمینی','official']], '3/15':[['قیام ۱۵ خرداد','official']],
  '3/20':[['روز جهانی صنایع دستی','global']], '3/31':[['شهادت دکتر مصطفی چمران','national']],
  '4/7':[['روز قوه قضائیه','national']], '4/10':[['روز صنعت و معدن','national']],
  '4/14':[['روز قلم','national']], '4/25':[['روز بهزیستی و تأمین اجتماعی','national']],
  '5/8':[['روز بزرگداشت شیخ شهاب‌الدین سهروردی','national']], '5/14':[['روز حقوق بشر اسلامی','national']],
  '5/17':[['روز خبرنگار','national']], '5/28':[['سالروز کودتای ۲۸ مرداد','national']],
  '6/1':[['روز بزرگداشت ابوعلی سینا و روز پزشک','national']], '6/4':[['روز کارمند','national']],
  '6/5':[['روز بزرگداشت زکریای رازی و روز داروساز','national']], '6/8':[['روز مبارزه با تروریسم','national']],
  '6/13':[['روز تعاون','national']], '6/27':[['روز شعر و ادب فارسی','national']],
  '6/31':[['آغاز هفته دفاع مقدس','national']], '7/1':[['روز آتش‌نشانی و ایمنی','national']],
  '7/8':[['روز بزرگداشت مولوی','national']], '7/13':[['روز نیروی انتظامی','national']],
  '7/14':[['روز دامپزشکی','national']], '7/20':[['روز بزرگداشت حافظ','national']],
  '7/24':[['روز ملی پارالمپیک','national']], '7/26':[['روز تربیت بدنی و ورزش','national']],
  '8/1':[['روز آمار و برنامه‌ریزی','national']], '8/8':[['روز نوجوان','national']],
  '8/13':[['روز دانش‌آموز','national']], '8/14':[['روز فرهنگ عمومی','national']],
  '8/24':[['روز کتاب و کتاب‌خوانی','national']], '9/7':[['روز نیروی دریایی','national']],
  '9/16':[['روز دانشجو','national']], '9/25':[['روز پژوهش','national']],
  '9/30':[['شب یلدا','national']], '10/5':[['روز ایمنی در برابر زلزله','national']],
  '10/13':[['روز جهانی مقاومت','national']], '10/19':[['قیام مردم قم','national']],
  '10/29':[['روز هوای پاک','national']], '11/12':[['بازگشت امام خمینی به ایران','national']],
  '11/22':[['پیروزی انقلاب اسلامی ایران','official']], '12/5':[['روز بزرگداشت خواجه نصیرالدین طوسی و روز مهندس','national']],
  '12/14':[['روز احسان و نیکوکاری','national']], '12/15':[['روز درختکاری','national']],
  '12/29':[['روز ملی شدن صنعت نفت ایران','official']]
};


const _GLOBAL_GREGORIAN_OCCASIONS = {
  '1/1':'سال نو میلادی', '1/24':'روز جهانی آموزش', '2/4':'روز جهانی مبارزه با سرطان',
  '2/14':'روز ولنتاین', '2/21':'روز جهانی زبان مادری', '3/8':'روز جهانی زنان',
  '3/20':'روز جهانی شادی', '3/21':'روز جهانی نوروز', '3/22':'روز جهانی آب',
  '4/2':'روز جهانی آگاهی از اوتیسم', '4/7':'روز جهانی بهداشت', '4/22':'روز زمین',
  '4/23':'روز جهانی کتاب', '5/1':'روز جهانی کارگر', '5/15':'روز جهانی خانواده',
  '5/17':'روز جهانی ارتباطات', '6/5':'روز جهانی محیط زیست', '6/20':'روز جهانی پناهندگان',
  '7/30':'روز جهانی دوستی', '8/12':'روز جهانی جوانان', '9/8':'روز جهانی سوادآموزی',
  '9/21':'روز جهانی صلح', '9/27':'روز جهانی گردشگری', '10/1':'روز جهانی سالمندان',
  '10/5':'روز جهانی معلم', '10/10':'روز جهانی سلامت روان', '10/16':'روز جهانی غذا',
  '11/14':'روز جهانی دیابت', '11/20':'روز جهانی کودک', '12/1':'روز جهانی ایدز',
  '12/3':'روز جهانی افراد دارای معلولیت', '12/10':'روز جهانی حقوق بشر', '12/25':'کریسمس'
};


const _ISLAMIC_OCCASIONS = {
  '1/1':[['آغاز سال هجری قمری','religious',false]], '1/9':[['تاسوعای حسینی','religious',true]],
  '1/10':[['عاشورای حسینی','religious',true]], '2/20':[['اربعین حسینی','religious',true]],
  '2/28':[['رحلت پیامبر اکرم و شهادت امام حسن مجتبی','religious',true]],
  '2/30':[['شهادت امام رضا','religious',true]], '3/8':[['شهادت امام حسن عسکری','religious',true]],
  '3/17':[['میلاد پیامبر اکرم و امام جعفر صادق','religious',true]],
  '5/13':[['شهادت حضرت فاطمه زهرا','religious',true]], '7/13':[['میلاد امام علی','religious',true]],
  '7/27':[['مبعث پیامبر اکرم','religious',true]], '8/3':[['میلاد امام حسین','religious',false]],
  '8/4':[['میلاد حضرت عباس','religious',false]], '8/5':[['میلاد امام سجاد','religious',false]],
  '8/15':[['میلاد امام مهدی','religious',true]], '9/15':[['میلاد امام حسن مجتبی','religious',false]],
  '9/19':[['شب قدر','religious',false]], '9/21':[['شهادت امام علی','religious',true]],
  '9/23':[['شب قدر','religious',false]], '10/1':[['عید فطر','religious',true]],
  '10/2':[['تعطیل عید فطر','religious',true]], '10/25':[['شهادت امام جعفر صادق','religious',true]],
  '12/10':[['عید قربان','religious',true]], '12/18':[['عید غدیر خم','religious',true]]
};


let _todoIslamicPartsFormatter = null;

function _todoIslamicParts(gy, gm, gd) {
  try {
    _todoIslamicPartsFormatter ||= new Intl.DateTimeFormat('en-u-ca-islamic', {year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'});
    const parts = Object.fromEntries(_todoIslamicPartsFormatter.formatToParts(new Date(Date.UTC(gy,gm-1,gd))).map(p => [p.type,p.value]));
    return [Number(parts.year), Number(parts.month), Number(parts.day)];
  } catch(e) { return [0,0,0]; }
}

// تقویم رسمی ایران ممکن است به‌دلیل رؤیت هلال با تقویم محاسباتی مرورگر
// یک روز اختلاف داشته باشد. این جدول، اختلاف رسمی هر سال شمسی را نگه می‌دارد.

const _IRAN_OFFICIAL_HIJRI_DAY_OFFSETS = { 1405: 1 };

function _todoOfficialIranIslamicParts(jy, gy, gm, gd) {
  const offset = _IRAN_OFFICIAL_HIJRI_DAY_OFFSETS[jy] || 0;
  const source = new Date(Date.UTC(gy,gm-1,gd));
  source.setUTCDate(source.getUTCDate() - offset);
  return _todoIslamicParts(source.getUTCFullYear(), source.getUTCMonth()+1, source.getUTCDate());
}


function _todoBuiltInOccasions(date, force = false) {
  if (!force && !_todoCalendarFilterActive('occasions')) return [];
  const [jy,jm,jd] = _jalaliParse(date);
  const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
  const out = [];
  (_IRAN_SOLAR_OCCASIONS[`${jm}/${jd}`] || []).forEach(([title,category]) => {
    if (_todoOccasionCategoryEnabled(category)) out.push({id:`solar-${category}-${jm}-${jd}`,title,type:'holiday',category,system:true,officialHoliday:category==='official'});
  });
  if (_todoOccasionCategoryEnabled('global')) {
    const title = _GLOBAL_GREGORIAN_OCCASIONS[`${gm}/${gd}`];
    if (title) out.push({id:`global-${gm}-${gd}`,title,type:'custom',category:'global',system:true});
  }
  if (_todoOccasionCategoryEnabled('religious')) {
    const [,hm,hd] = _todoOfficialIranIslamicParts(jy,gy,gm,gd);
    const next = _addDays(jy,jm,jd,1);
    const ng = jalaliToGregorian(...next);
    const [,nextHm] = _todoOfficialIranIslamicParts(next[0],ng[0],ng[1],ng[2]);
    const islamicItems = [...(_ISLAMIC_OCCASIONS[`${hm}/${hd}`] || [])];
    if (hm === 2 && nextHm === 3 && hd !== 30) islamicItems.push(...(_ISLAMIC_OCCASIONS['2/30'] || []));
    islamicItems.forEach(([title,category,officialHoliday]) => {
      out.push({id:`islamic-${hm}-${hd}`,title,type:'holiday',category,system:true,officialHoliday, hijriDate:`${hm}/${hd}`});
    });
  }
  return out;
}


function _todoOfficialHolidaysForDate(date) {
  const [jy,jm,jd] = _jalaliParse(date);
  const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
  const out = [];
  (_IRAN_SOLAR_OCCASIONS[`${jm}/${jd}`] || []).forEach(([title,category]) => {
    if (category === 'official') out.push(title);
  });
  const [,hm,hd] = _todoOfficialIranIslamicParts(jy,gy,gm,gd);
  const next = _addDays(jy,jm,jd,1);
  const ng = jalaliToGregorian(...next);
  const [,nextHm] = _todoOfficialIranIslamicParts(next[0],ng[0],ng[1],ng[2]);
  const items = [...(_ISLAMIC_OCCASIONS[`${hm}/${hd}`] || [])];
  if (hm === 2 && nextHm === 3 && hd !== 30) items.push(...(_ISLAMIC_OCCASIONS['2/30'] || []));
  items.filter(x => x[2]).forEach(x => out.push(x[0]));
  return out;
}


function _todoEventTypeMeta(type) {
  const t = type === 'anniversary' ? 'wedding_anniversary' : (type || 'custom');
  const map = {
    custom: { icon:'📝', label:'مناسبت شخصی', color:'#60a5fa' },
    birthday: { icon:'🎂', label:'تولد', color:'#ec4899' },
    wedding_anniversary: { icon:'👩‍❤️‍👨', label:'سالگرد ازدواج', color:'#f472b6' },
    holiday: { icon:'🏖️', label:'تعطیل/مناسبت', color:'#f59e0b' },
  };
  return map[t] || map.custom;
}


function _todoEventMatchesDate(e, date) {
  if (!e || !date) return false;
  if (e.date_jalali === date) return true;
  if (!e.date_jalali || !e.repeat || e.repeat === 'none') return false;
  const [ey,em,ed] = _jalaliParse(e.date_jalali);
  const [y,m,d] = _jalaliParse(date);
  const [egy,egm,egd] = jalaliToGregorian(ey,em,ed);
  const [gy,gm,gd] = jalaliToGregorian(y,m,d);
  const elapsedDays = Math.round((Date.UTC(gy,gm-1,gd) - Date.UTC(egy,egm-1,egd)) / 86400000);
  if (elapsedDays < 0) return false;
  if (e.repeat === 'weekly') return elapsedDays % 7 === 0;
  if (e.repeat === 'every_days') {
    const interval = Math.max(1, Number(e.repeat_days) || 1);
    return elapsedDays % interval === 0;
  }
  if (e.repeat === 'monthly') return d === ed;
  if (e.repeat === 'yearly') return m === em && d === ed;
  return false;
}


function _todoCalendarFilterActive(key) {
  return _todoCalendarDataFilters.has(key);
}


function _saveTodoCalendarDataFilters() {
  localStorage.setItem('tp_todo_calendar_data_filters', JSON.stringify([..._todoCalendarDataFilters]));
}


function _toggleTodoCalendarDataFilter(key) {
  if (!_TODO_CALENDAR_FILTER_KEYS.includes(key)) return;
  if (_todoCalendarDataFilters.has(key)) _todoCalendarDataFilters.delete(key);
  else _todoCalendarDataFilters.add(key);
  _saveTodoCalendarDataFilters();
  _renderTodoSurface();
}


function _setAllTodoCalendarDataFilters(enabled) {
  _todoCalendarDataFilters = new Set(enabled ? _TODO_CALENDAR_FILTER_KEYS : []);
  _saveTodoCalendarDataFilters();
  _renderTodoSurface();
}


function _toggleAllTodoCalendarDataFilters() {
  _setAllTodoCalendarDataFilters(_todoCalendarDataFilters.size !== _TODO_CALENDAR_FILTER_KEYS.length);
}


function _todoCalendarTaskDataType(t) {
  const kind = _todoCategoryMeta(t).kind;
  if (kind === 'sessions') return 'sessions';
  if (kind === 'habits') return 'habits';
  return 'tasks';
}


function _todoCalendarHasTaskFilters() {
  return ['tasks','sessions','habits'].some(key => _todoCalendarFilterActive(key));
}


function _todoCalendarDataFilterChipsHtml() {
  const chips = [
    ['tasks','✅','کارها'], ['sessions','👥','جلسات'], ['habits','🔥','عادت‌ها'],
    ['reminders','🔔','یادآورها'], ['occasions','📌','مناسبت‌ها'], ['birthdays','🎂','تولدها']
  ];
  const all = _todoCalendarDataFilters.size === _TODO_CALENDAR_FILTER_KEYS.length;
  return `<details class="todo-calendar-filter-panel" aria-label="فیلتر داده‌های تقویم">
    <summary class="todo-calendar-filter-title">
      <span>فیلتر نمایش تقویم</span>
      <span>${fa(_todoCalendarDataFilters.size)} از ${fa(_TODO_CALENDAR_FILTER_KEYS.length)} نوع فعال</span>
    </summary>
    <div class="todo-calendar-filter-chips">
      <button type="button" class="todo-filter-chip all ${all?'active':''}" onclick="_toggleAllTodoCalendarDataFilters()" aria-pressed="${all}">همه</button>
      ${chips.map(([key,icon,label]) => {
        const active = _todoCalendarFilterActive(key);
        return `<button type="button" class="todo-filter-chip ${active?'active':''}" onclick="_toggleTodoCalendarDataFilter('${key}')" aria-pressed="${active}"><span>${icon}</span>${label}</button>`;
      }).join('')}
      <button type="button" class="todo-filter-clear" onclick="_setAllTodoCalendarDataFilters(false)" ${_todoCalendarDataFilters.size?'':'disabled'}>پاک کردن فیلترها</button>
    </div>
  </details>`;
}


function _toggleCalendarAddMenu() {
  _calendarAddMenuOpen = !_calendarAddMenuOpen;
  _renderTodoSurface();
}


function _closeCalendarAddMenu() {
  if (!_calendarAddMenuOpen) return;
  _calendarAddMenuOpen = false;
  document.querySelectorAll('.calendar-add-menu').forEach(el => el.remove());
}

if (!window._calendarAddMenuDismissBound) {
  window._calendarAddMenuDismissBound = true;
  document.addEventListener('pointerdown', e => {
    if (_calendarAddMenuOpen && !e.target.closest?.('.calendar-add-wrap,.calendar-add-menu,.topbar-calendar-add')) _closeCalendarAddMenu();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeCalendarAddMenu(); });
  document.addEventListener('scroll', _closeCalendarAddMenu, true);
}


function _calendarAddMenuHtml() {
  if (!_calendarAddMenuOpen) return '';
  const item = (kind,icon,label) => `<button type="button" onclick="_openCalendarCreate('${kind}',_todoCalendarSelectedDate||_todayJalaliStr())">${icon} ${label}</button>`;
  return `<div class="calendar-add-menu" onclick="event.stopPropagation()">
    ${item('task','✅','کار جدید')}
    ${item('session','👥','جلسه')}
    ${item('habit','🔥','عادت')}
    ${item('reminder','🔔','یادآور')}
    ${item('occasion','📌','مناسبت شخصی')}
    ${item('birthday','🎂','تولد')}
  </div>`;
}


async function _openCalendarCreate(kind, date) {
  _calendarAddMenuOpen = false;
  closeCalendarDayPanel();
  if (kind === 'task') return openAddTodo(date);
  if (kind === 'session') {
    await openAddSessionGeneral();
    setTimeout(() => { const input=document.getElementById('f-ses-date'); if(input){input.value=date;input.dispatchEvent(new Event('change',{bubbles:true}));} },0);
    return;
  }
  if (kind === 'habit') return openAddHabit();
  if (kind === 'reminder') {
    openAddReminder();
    setTimeout(() => { const input=document.getElementById('r-date'); if(input) input.value=date; },0);
    return;
  }
  return openAddTodoCalendarEvent(date, kind === 'birthday' ? 'birthday' : 'custom');
}


function _todoCustomEvents(date, force = false) {
  return (_db.todo_calendar_events || []).filter(e => {
    if (!_todoEventMatchesDate(e, date)) return false;
    if (e.type === 'birthday') return (force || _todoCalendarFilterActive('birthdays')) && _todoOccasionCategoryEnabled('birthdays');
    if (e.type === 'wedding_anniversary' || e.type === 'anniversary') return (force || _todoCalendarFilterActive('occasions')) && _todoOccasionCategoryEnabled('anniversaries');
    return (force || _todoCalendarFilterActive('occasions')) && _todoOccasionCategoryEnabled('personal');
  });
}


function _todoEventReminderDate(e, occurrenceDate) {
  const days = Number(e?.remind_days ?? -1);
  if (!Number.isFinite(days) || days < 0 || !occurrenceDate) return '';
  const [jy,jm,jd] = _jalaliParse(occurrenceDate);
  return _formatJalali(..._addDays(jy,jm,jd,-days));
}


function _todoEventReminderItems(date, force = false) {
  if (!force && !_todoCalendarFilterActive('reminders')) return [];
  const out = [];
  (_db.todo_calendar_events || []).forEach(e => {
    const days = Number(e.remind_days ?? -1);
    if (!Number.isFinite(days) || days <= 0 || !e.date_jalali) return;
    const occurrenceDate = _formatJalali(..._addDays(..._jalaliParse(date), days));
    if (_todoEventMatchesDate(e, occurrenceDate)) {
      out.push({ ...e, id:`event-reminder-${e.id}-${occurrenceDate}`, title:`یادآوری: ${e.title}`, date_jalali:date, _reminder:true, _occurrence_date:occurrenceDate, system:true });
    }
  });
  return out;
}


function _todoCalendarEvents(date, force = false) {
  const list = [..._todoBuiltInOccasions(date, force), ..._todoCustomEvents(date, force), ..._todoEventReminderItems(date, force)];
  const q = (_todoCalendarSearch || '').trim().toLowerCase();
  return q ? list.filter(e => `${e.title || ''} ${_todoEventTypeMeta(e.type).label || ''}`.toLowerCase().includes(q)) : list;
}


function _todoCalendarSessions(date, force = false) {
  if (!force && !_todoCalendarFilterActive('sessions')) return [];
  return (_db.sessions || []).filter(s => _jalaliKey(s.date_jalali || s.date || '') === _jalaliKey(date));
}


function _todoCalendarHabits(date, force = false) {
  if (!force && !_todoCalendarFilterActive('habits')) return [];
  const dateKey = _jalaliKey(date);
  return (_db.habits || []).filter(h => {
    if (h.archived) return false;
    if (!h.created_at) return true;
    const created = new Date(h.created_at);
    if (Number.isNaN(created.getTime())) return true;
    const j = gregorianToJalali(created.getFullYear(),created.getMonth()+1,created.getDate());
    return _jalaliKey(_formatJalali(...j)) <= dateKey;
  }).map(h => ({ ...h, _doneOnDate:(_db.habit_logs || []).some(l => String(l.habit_id) === String(h.id) && _jalaliKey(l.date) === dateKey && l.done) }));
}


function _todoCalendarPaymentReminders(date, force = false) {
  if (!force && !_todoCalendarFilterActive('reminders')) return [];
  const key = _jalaliKey(date);
  const studentName = id => {
    const s = (_db.students || []).find(x => String(x.id) === String(id));
    return s ? `${s.name || ''} ${s.lname || ''}`.trim() : '';
  };
  const customer = (_db.reminders || []).filter(r => !r.done && _jalaliKey(r.due_date_jalali || r.due_date || r.date_jalali || '') === key)
    .map(r => ({...r,_calendarReminderKind:'customer',_personName:studentName(r.student_id)}));
  const staff = (_db.staff_reminders || []).filter(r => !r.done && _jalaliKey(r.due_date_jalali || r.due_date || '') === key)
    .map(r => ({...r,_calendarReminderKind:'staff'}));
  return [...customer,...staff];
}


function _todoCalendarKeyEvents(date, force = false) {
  if (!force && !_todoCalendarFilterActive('reminders')) return [];
  const key = _jalaliKey(date);
  return (_db.key_events || [])
    .filter(e => _jalaliKey(e.date_jalali || '') === key || (!e.remind_done && _jalaliKey(e.remind_date || '') === key))
    .map(e => {
      const person = (_db.students || []).find(s => String(s.id) === String(e.student_id));
      return {...e,_personName:person ? `${person.name || ''} ${person.lname || ''}`.trim() : ''};
    });
}


function _openTodoCalendarKeyEvent(id) {
  const event = (_db.key_events || []).find(e => String(e.id) === String(id));
  if (!event) return;
  const person = (_db.students || []).find(s => String(s.id) === String(event.student_id));
  const name = person ? `${person.name || ''} ${person.lname || ''}`.trim() : '';
  if (typeof openKeyEvents === 'function' && event.student_id != null) openKeyEvents(event.student_id, name);
}


function _todoMiniSessionHtml(s) {
  const title = s.title || s.subject || `${META.sessionSingular || 'جلسه'}`;
  return `<div class="todo-mini-session" onclick="event.stopPropagation();openSessionDetail(${s.id})" style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:rgba(96,165,250,.12);border-right:3px solid #60a5fa;cursor:pointer">
    <span>👥</span><span style="font-size:10px;color:#60a5fa;font-weight:800">${escapeHtml(s.time || '')}</span><span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(title)}</span>
  </div>`;
}


function _todoMiniHabitHtml(h) {
  return `<div class="todo-mini-habit" onclick="event.stopPropagation();openHabitDetail(${h.id})" style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:${h.color || '#34d399'}18;border-right:3px solid ${h.color || '#34d399'};cursor:pointer">
    <span>${escapeHtml(h.icon || '🔥')}</span><span style="font-size:10px;color:${h.color || '#34d399'};font-weight:800">${h._doneOnDate?'✓':'عادت'}</span><span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(h.title || '')}</span>
  </div>`;
}


function _todoMiniReminderHtml(r) {
  return `<div class="todo-mini-reminder" style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:rgba(245,158,11,.11);border-right:3px solid #f59e0b">
    <span>🔔</span><span style="font-size:10px;color:#f59e0b;font-weight:800">یادآور</span><span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.title || 'یادآوری')}${r._personName?' · '+escapeHtml(r._personName):''}</span>
  </div>`;
}


function _todoMiniKeyEventHtml(e) {
  const personName = e._personName || (() => {
    const person = (_db.students || []).find(s => String(s.id) === String(e.student_id));
    return person ? `${person.name || ''} ${person.lname || ''}`.trim() : '';
  })();
  const plainText = (e.text || '').replace(/<[^>]*>/g,' ');
  return `<div class="todo-mini-key-event" onclick="event.stopPropagation();_openTodoCalendarKeyEvent(${JSON.stringify(e.id)})" title="${escapeHtml(personName ? personName + ' · ' + plainText : plainText)}" style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:rgba(251,191,36,.10);border-right:3px solid #fbbf24;cursor:${personName?'pointer':'default'}">
    <span>⭐</span><span style="font-size:10px;color:#fbbf24;font-weight:800;flex-shrink:0">رویداد مهم</span>${personName?`<span style="font-size:10px;color:#fde68a;font-weight:900;flex-shrink:0;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.22);border-radius:999px;padding:1px 6px">👤 ${escapeHtml(personName)}</span>`:''}<span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(plainText)}</span>
  </div>`;
}


function _todoEventReminderLabel(e) {
  const days = Number(e?.remind_days ?? -1);
  if (!Number.isFinite(days) || days < 0) return '';
  return days === 0 ? 'یادآوری در همان روز' : `یادآوری ${fa(days)} روز قبل`;
}


function _todoEventRepeatLabel(e) {
  const repeat = e?.repeat || 'none';
  if (repeat === 'weekly') return 'هفتگی';
  if (repeat === 'every_days') return `هر ${fa(Math.max(1, Number(e.repeat_days) || 1))} روز`;
  if (repeat === 'monthly') return 'ماهانه';
  if (repeat === 'yearly') return 'سالانه';
  return '';
}


function _syncTodoEventRepeatDays() {
  const wrap = document.getElementById('cal-event-repeat-days-wrap');
  if (wrap) wrap.style.display = document.getElementById('cal-event-repeat')?.value === 'every_days' ? 'block' : 'none';
}


function _clearStudentBirthday(studentId) {
  const s = (_db.students || []).find(x => x.id == studentId);
  if (!s) return;
  if (!confirm('تاریخ تولد این شاگرد از تقویم حذف شود؟')) return;
  ['birth_jalali','birthday_jalali','birth_date','birthday'].forEach(k => { if (s[k] !== undefined) s[k] = ''; });
  s.updated_at = new Date().toISOString();
  _todoBirthdayIndexCache = { sig: '', map: new Map() };
  _save();
  closeModal();
  _renderTodoSurface();
  showToast('تولد از تقویم حذف شد', 'success');
}


function openAddTodoCalendarEvent(date = _todoCalendarSelectedDate || _todayJalaliStr(), presetType = 'custom') {
  openModal('افزودن مناسبت', `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">عنوان مناسبت</label>
        <input class="form-input" id="cal-event-title" placeholder="مثلاً: سالگرد شروع همکاری">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ</label>
        <input class="form-input jdate" id="cal-event-date" value="${date}">
      </div>
      <div class="form-group">
        <label class="form-label">نوع</label>
        <select class="form-input" id="cal-event-type">
          <option value="custom" ${presetType==='custom'?'selected':''}>📝 مناسبت شخصی</option>
          <option value="birthday" ${presetType==='birthday'?'selected':''}>🎂 تولد</option>
          <option value="wedding_anniversary" ${presetType==='wedding_anniversary'?'selected':''}>👩‍❤️‍👨 سالگرد ازدواج</option>
          <option value="holiday" ${presetType==='holiday'?'selected':''}>🏖️ تعطیل/مناسبت</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">تکرار</label>
        <select class="form-input" id="cal-event-repeat" onchange="_syncTodoEventRepeatDays()">
          <option value="none">بدون تکرار</option>
          <option value="weekly">هفتگی</option>
          <option value="every_days">هر X روز</option>
          <option value="monthly">ماهانه</option>
          <option value="yearly">سالانه</option>
        </select>
      </div>
      <div class="form-group" id="cal-event-repeat-days-wrap" style="display:none">
        <label class="form-label">تکرار هر چند روز؟</label>
        <input class="form-input" id="cal-event-repeat-days" type="number" min="1" step="1" value="2" inputmode="numeric">
      </div>
      <div class="form-group">
        <label class="form-label">یادآوری</label>
        <select class="form-input" id="cal-event-remind">
          <option value="-1">بدون یادآوری</option>
          <option value="0">همان روز</option>
          <option value="1">۱ روز قبل</option>
          <option value="3">۳ روز قبل</option>
          <option value="7">۷ روز قبل</option>
          <option value="30">۳۰ روز قبل</option>
        </select>
      </div>
    </div>
  `, [
    { label:'ثبت مناسبت', cls:'btn-primary', action:'saveTodoCalendarEvent()' },
    { label:'انصراف', cls:'btn-ghost', action:'closeModal()' },
  ]);
  setTimeout(() => document.querySelectorAll('.modal-overlay.open .jdate, .modal .jdate').forEach(el => attachJalaliDatePicker(el)), 0);
}


function saveTodoCalendarEvent() {
  _todosInit();
  const title = document.getElementById('cal-event-title')?.value.trim();
  const date = document.getElementById('cal-event-date')?.value.trim();
  const type = document.getElementById('cal-event-type')?.value || 'custom';
  const repeat = document.getElementById('cal-event-repeat')?.value || 'none';
  const repeatDays = repeat === 'every_days' ? Math.max(1, +(document.getElementById('cal-event-repeat-days')?.value || 1)) : null;
  const remindDays = +(document.getElementById('cal-event-remind')?.value ?? -1);
  if (!title || !date) { showToast('عنوان و تاریخ مناسبت را وارد کنید', 'error'); return; }
  _db.todo_calendar_events.push({ id:_db._nextId.todo_calendar_events++, title, date_jalali:date, type, repeat, repeat_days:repeatDays, remind_days:remindDays, created_at:new Date().toISOString() });
  _save();
  closeModal();
  _renderTodoSurface();
  showToast('مناسبت اضافه شد', 'success');
}


function deleteTodoCalendarEvent(id) {
  if (!confirm('این مناسبت حذف شود؟')) return;
  _db.todo_calendar_events = (_db.todo_calendar_events || []).filter(e => String(e.id) !== String(id));
  _save();
  closeModal();
  _renderTodoSurface();
  showToast('مناسبت حذف شد', 'success');
}


function _saveTodoDayNote(date) {
  const val = document.getElementById('todo-day-note')?.value || '';
  if (!_db.todo_day_notes) _db.todo_day_notes = {};
  _db.todo_day_notes[date] = val.trim();
  _save(false);
}


function _moveTodoToDate(id, date) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t || !date) return;
  t.date_jalali = date;
  t.archived = false;
  _save();
  _selectTodoCalendarDay(date);
  showToast('تاریخ کار جابه‌جا شد', 'success');
}


function _todoDragStart(event, id) {
  _todoDragId = id;
  event.dataTransfer?.setData('text/plain', String(id));
  event.dataTransfer && (event.dataTransfer.effectAllowed = 'move');
}


function _todoDropOnDate(event, date) {
  event.preventDefault();
  event.stopPropagation();
  const id = event.dataTransfer?.getData('text/plain') || _todoDragId;
  _todoDragId = null;
  if (id) _moveTodoToDate(id, date);
}


function _todoCalendarResponsiveCss() {
  // Calendar layout lives in app.css; keep this helper for older call sites.
  return '';
}

function _todoCategoryMeta(t) {
  const text = `${escapeHtml(t.title || '')} ${escapeHtml(t.description || '')}`.toLowerCase();
  const cat = t.category || '';
  if (/جلسه|کال|ملاقات|رزرو/.test(text)) return { icon:'📅', label:'جلسه', kind:'sessions', color:'#60a5fa' };
  if (/تماس|زنگ|پیگیری/.test(text)) return { icon:'📞', label:'تماس', kind:'call', color:'#38bdf8' };
  if (/آموزش|درس|مطالعه|یادگیری|تمرین|دانش/.test(text)) return { icon:'🧠', label:'آموزش', kind:'education', color:'#22d3ee' };
  if (/ورزش|پیاده|باشگاه|دویدن|روتین|عادت/.test(text) || cat === 'routine') return { icon:'🏃', label:'روتین', kind:'habits', color:'#34d399' };
  if (/پرداخت|هزینه|مالی|قسط|حقوق|پول|فاکتور/.test(text)) return { icon:'💰', label:'مالی', kind:'finance', color:'#f59e0b' };
  if (t.goal_id) return { icon:'🎯', label:'هدف', kind:'goals', color:'var(--accent2)' };
  if (cat === 'personal') return { icon:'👤', label:'شخصی', kind:'personal', color:'var(--accent2)' };
  if (cat === 'clients') return { icon:'👥', label:'مشتریان', kind:'clients', color:'#60a5fa' };
  return { icon:'📝', label:'کار', kind:'task', color:'var(--accent2)' };
}


function _todoStatusColor(t) {
  const meta = _todoCategoryMeta(t);
  if (t.done) return { color:'var(--green)', bg:'rgba(62,207,142,.12)', label:'انجام شده' };
  if (t.priority === 'urgent') return { color:'var(--red)', bg:'rgba(255,107,107,.14)', label:'فوری' };
  if (t.priority === 'high') return { color:'var(--amber)', bg:'rgba(245,158,11,.14)', label:'مهم' };
  if (meta.kind === 'sessions') return { color:'#60a5fa', bg:'rgba(96,165,250,.14)', label:'جلسه' };
  if (meta.kind === 'personal') return { color:'var(--accent2)', bg:'rgba(124,106,247,.14)', label:'شخصی' };
  return { color:meta.color, bg:'rgba(124,106,247,.11)', label:meta.label };
}


function _todoFilteredCalendarTasks(tasks) {
  const q = (_todoCalendarSearch || '').trim().toLowerCase();
  return tasks.filter(t => {
    if (!_todoCalendarFilterActive(_todoCalendarTaskDataType(t))) return false;
    const meta = _todoCategoryMeta(t);
    const hay = `${t.title || ''} ${t.description || ''} ${meta.label || ''}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (['week','month','year'].includes(_todoViewMode)) return true;
    if (_todoCalendarFilter === 'urgent') return t.priority === 'urgent';
    if (_todoCalendarFilter === 'open') return !t.done;
    if (_todoCalendarFilter === 'sessions') return meta.kind === 'sessions';
    if (_todoCalendarFilter === 'habits') return meta.kind === 'habits';
    if (_todoCalendarFilter === 'goals') return !!t.goal_id || meta.kind === 'goals';
    return true;
  });
}


function _todoTimeBucket(t) {
  if (!t.time) return 'بدون ساعت';
  const h = parseInt(String(t.time).split(':')[0], 10);
  if (h < 12) return 'صبح';
  if (h < 17) return 'ظهر';
  return 'عصر';
}


function _todoCalendarStats(tasks, weekCells) {
  const today = _todayJalaliStr();
  const todayKey = _jalaliKey(today);
  const weekKeys = new Set((weekCells || []).map(d => _jalaliKey(_formatJalali(d[0],d[1],d[2]))));
  const active = tasks.filter(t => !t.done).length;
  const todayTasks = tasks.filter(t => t.date_jalali === today);
  const done = tasks.filter(t => t.done).length;
  const overdue = tasks.filter(t => !t.done && t._key < todayKey);
  const weekTasks = weekCells ? tasks.filter(t => weekKeys.has(t._key)) : [];
  const weekDone = weekTasks.filter(t => t.done).length;
  const weekPercent = weekTasks.length ? Math.round((weekDone / weekTasks.length) * 100) : 0;
  const nearest = tasks.filter(t => !t.done && t._key >= todayKey).sort((a,b) => a._key - b._key || (a.time||'').localeCompare(b.time||''))[0];
  return { active, todayTasks, done, overdue, weekTasks, weekDone, weekPercent, nearest };
}


function _todoRangePerformance(tasks, currentKeys, previousKeys) {
  const inSet = (set) => (t) => set.has(t._key);
  const current = tasks.filter(inSet(currentKeys));
  const previous = tasks.filter(inSet(previousKeys));
  const done = current.filter(t => t.done).length;
  const prevDone = previous.filter(t => t.done).length;
  const percent = current.length ? Math.round(done / current.length * 100) : 0;
  const prevPercent = previous.length ? Math.round(prevDone / previous.length * 100) : 0;
  return { total: current.length, done, percent, prevTotal: previous.length, prevDone, prevPercent, delta: percent - prevPercent };
}


function _todoPerformanceReportHtml(title, perf) {
  const delta = perf.delta || 0;
  const deltaColor = delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text3)';
  const deltaText = perf.prevTotal
    ? (delta > 0 ? `+${fa(delta)}٪ بهتر از بازه قبل` : delta < 0 ? `${fa(delta)}٪ نسبت به بازه قبل` : 'بدون تغییر نسبت به بازه قبل')
    : 'برای مقایسه با بازه قبل داده‌ای نیست';
  return `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px;flex-wrap:wrap">
      <div>
        <b style="font-size:13px;color:var(--text)">${title}</b>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${fa(perf.done)} از ${fa(perf.total)} کار انجام شده</div>
      </div>
      <div style="text-align:left">
        <div style="font-size:20px;font-weight:900;color:${perf.percent >= 80 ? 'var(--green)' : perf.percent >= 50 ? 'var(--accent2)' : 'var(--amber)'}">${fa(perf.percent)}٪</div>
        <div style="font-size:11px;font-weight:800;color:${deltaColor};margin-top:2px">${deltaText}</div>
      </div>
    </div>
    <div style="height:8px;background:rgba(255,255,255,.06);border-radius:999px;overflow:hidden">
      <div style="height:100%;width:${perf.percent}%;background:linear-gradient(90deg,var(--green),var(--accent2));border-radius:999px"></div>
    </div>
    ${perf.prevTotal ? `<div style="margin-top:8px;font-size:11px;color:var(--text3)">بازه قبل: ${fa(perf.prevDone)} از ${fa(perf.prevTotal)} کار (${fa(perf.prevPercent)}٪)</div>` : ''}
  </div>`;
}


function _todoDateKeysBetween(startArr, count) {
  return new Set(Array.from({length: count}, (_,i) => {
    const d = _addDays(startArr[0], startArr[1], startArr[2], i);
    return _jalaliKey(_formatJalali(d[0], d[1], d[2]));
  }));
}


function _todoMonthKeys(jy, jm) {
  const days = _jalaliDaysInMonth(jy, jm);
  return _todoDateKeysBetween([jy, jm, 1], days);
}


function _todoYearKeys(jy) {
  const keys = new Set();
  for (let jm = 1; jm <= 12; jm++) {
    _todoMonthKeys(jy, jm).forEach(k => keys.add(k));
  }
  return keys;
}


function _todoWeekRangeLabel(cells) {
  if (!cells || !cells.length) return '';
  const first = cells[0], last = cells[cells.length - 1];
  const a = `${fa(first[2])} ${JMONTHS[first[1]-1]}`;
  const b = `${fa(last[2])} ${JMONTHS[last[1]-1]}`;
  return `${a} تا ${b}`;
}


function _todoMiniEventHtml(t) {
  const meta = _todoCategoryMeta(t);
  const s = _todoStatusColor(t);
  return `<div draggable="true" ondragstart="_todoDragStart(event,${t.id})" onclick="event.stopPropagation();openEditTodo(${t.id})"
    title="${escapeHtml(meta.label)} - ${escapeHtml(t.title)}"
    style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:${s.bg};border-right:3px solid ${s.color};cursor:pointer">
    <span style="font-size:12px;line-height:1;flex-shrink:0">${escapeHtml(meta.icon)}</span>
    ${t._repeatPreview ? '<span style="font-size:10px;line-height:1;flex-shrink:0" title="تکرار آینده">🔁</span>' : ''}
    <span style="font-size:10px;color:${s.color};font-weight:800;flex-shrink:0">${t.time ? escapeHtml(_todoTimeRangeLabel(t)) : '•'}</span>
    <span style="font-size:11px;color:${t.done?'var(--text3)':'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-decoration:${t.done?'line-through':'none'}">${escapeHtml(t.title)}</span>
  </div>`;
}


function _openTodoDayPopover(date) {
  _todoCalendarSelectedDate = date || _todayJalaliStr();
  localStorage.setItem('tp_todo_calendar_selected_date', _todoCalendarSelectedDate);
  const list = _todoTasksForCalendar().filter(t => t.date_jalali === _todoCalendarSelectedDate);
  const sessions = _todoCalendarSessions(_todoCalendarSelectedDate, true);
  const habits = _todoCalendarHabits(_todoCalendarSelectedDate, true);
  const reminders = _todoCalendarPaymentReminders(_todoCalendarSelectedDate, true);
  const keyEvents = _todoCalendarKeyEvents(_todoCalendarSelectedDate, true);
  const birthdays = _todoCalendarBirthdays(_todoCalendarSelectedDate, true);
  const events = _todoCalendarEvents(_todoCalendarSelectedDate, true);
  const note = (_db.todo_day_notes && _db.todo_day_notes[_todoCalendarSelectedDate]) || '';
  const section = (icon,title,items,render,empty='موردی ثبت نشده است.') => `<div class="calendar-day-section">
    <div class="calendar-day-section-title"><span>${icon} ${title}</span><span>${fa(items.length)}</span></div>
    <div style="display:flex;flex-direction:column;gap:6px">${items.map(render).join('') || `<span style="font-size:11px;color:var(--text3)">${empty}</span>`}</div>
  </div>`;
  const panel = document.createElement('div');
  panel.className = 'calendar-day-panel-overlay';
  panel.id = 'calendar-day-panel-overlay';
  panel.onclick = e => { if (e.target === panel) closeCalendarDayPanel(); };
  panel.innerHTML = `<aside class="calendar-day-panel" role="dialog" aria-label="جزئیات روز">
    <div class="calendar-day-panel-head">
      <div><b style="font-size:15px;color:var(--text)">جزئیات روز</b><div style="font-size:11px;color:var(--accent2);margin-top:3px">${DateService.disp(_todoCalendarSelectedDate)} · ${jalaliWeekdayName(_todoCalendarSelectedDate)}</div></div>
      <button class="btn btn-ghost btn-sm" onclick="closeCalendarDayPanel()">✕</button>
    </div>
    <div class="calendar-day-create-grid">
      <button class="btn btn-primary btn-sm" onclick="_openCalendarCreate('task','${_todoCalendarSelectedDate}')">✅ کار</button>
      <button class="btn btn-ghost btn-sm" onclick="_openCalendarCreate('session','${_todoCalendarSelectedDate}')">👥 جلسه</button>
      <button class="btn btn-ghost btn-sm" onclick="_openCalendarCreate('habit','${_todoCalendarSelectedDate}')">🔥 عادت</button>
      <button class="btn btn-ghost btn-sm" onclick="_openCalendarCreate('reminder','${_todoCalendarSelectedDate}')">🔔 یادآور</button>
      <button class="btn btn-ghost btn-sm" onclick="_openCalendarCreate('occasion','${_todoCalendarSelectedDate}')">📌 مناسبت</button>
      <button class="btn btn-ghost btn-sm" onclick="_openCalendarCreate('birthday','${_todoCalendarSelectedDate}')">🎂 تولد</button>
    </div>
    ${section('✅','کارها',list,_todoMiniEventHtml)}
    ${section('👥','جلسات',sessions,_todoMiniSessionHtml)}
    ${section('🔥','عادت‌ها',habits,_todoMiniHabitHtml)}
    ${section('🔔','یادآورها',reminders,_todoMiniReminderHtml)}
    ${section('⭐','رویدادهای مهم',keyEvents,_todoMiniKeyEventHtml)}
    ${section('📌','مناسبت‌ها',events,_todoMiniOccasionHtml)}
    ${section('🎂','تولدها',birthdays,_todoMiniBirthdayHtml)}
    <div class="calendar-day-section">
      <div class="calendar-day-section-title"><span>📝 یادداشت روز</span><span style="font-weight:500">ذخیره خودکار</span></div>
      <textarea class="form-textarea" id="todo-day-note" rows="4" oninput="_saveTodoDayNote('${_todoCalendarSelectedDate}')" placeholder="یادداشت این روز...">${escapeHtml(note)}</textarea>
    </div>
  </aside>`;
  closeCalendarDayPanel();
  document.body.appendChild(panel);
}


function closeCalendarDayPanel() {
  document.getElementById('calendar-day-panel-overlay')?.remove();
}


function _calendarDateFromJalali(date = _todoCalendarCursor || _todayJalaliStr()) {
  const [jy,jm,jd] = _jalaliParse(date);
  const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
  return new Date(gy, gm - 1, gd);
}


function _jalaliFromDateObj(date) {
  const [jy,jm,jd] = gregorianToJalali(date.getFullYear(), date.getMonth() + 1, date.getDate());
  return _formatJalali(jy,jm,jd);
}


function _calendarModeLabel() {
  return DateService.isGregorian() ? 'میلادی' : 'شمسی';
}


function _calendarPeriodLabel() {
  const view = ['week','month','year'].includes(_todoViewMode) ? _todoViewMode : 'month';
  if (DateService.isGregorian()) {
    const d = _calendarDateFromJalali(_todoCalendarCursor || _todayJalaliStr());
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    if (view === 'year') return String(d.getFullYear());
    if (view === 'month') return `${months[d.getMonth()]} ${d.getFullYear()}`;
    const start = new Date(d);
    start.setDate(d.getDate() - ((d.getDay() + 1) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${months[start.getMonth()]} ${start.getDate()} - ${months[end.getMonth()]} ${end.getDate()}`;
  }
  const [jy,jm] = _jalaliParse(_todoCalendarCursor || _todayJalaliStr());
  if (view === 'year') return `سال ${fa(jy)}`;
  if (view === 'month') return `${JMONTHS[jm - 1]} ${fa(jy)}`;
  const cells = (() => {
    const [cy,cm,cd] = _jalaliParse(_todoCalendarCursor || _todayJalaliStr());
    const [gy,gm,gd] = jalaliToGregorian(cy,cm,cd);
    const dow = new Date(gy,gm - 1,gd).getDay();
    const daysFromSaturday = (dow + 1) % 7;
    const start = _addDays(cy,cm,cd,-daysFromSaturday);
    return [start, _addDays(start[0],start[1],start[2],6)];
  })();
  return `${fa(cells[0][2])} ${JMONTHS[cells[0][1]-1]} تا ${fa(cells[1][2])} ${JMONTHS[cells[1][1]-1]}`;
}


function _calendarPageHeaderHtml() {
  const view = ['week','month','year'].includes(_todoViewMode) ? _todoViewMode : 'month';
  const option = (value, label) => `<option value="${value}" ${view === value ? 'selected' : ''}>${label}</option>`;
  return `<div class="todo-calendar-header">
    <div class="todo-calendar-header-main" style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;flex-wrap:wrap">
      <div>
        <div class="todo-calendar-period-title">${_calendarPeriodLabel()}</div>
      </div>
      <div class="calendar-add-wrap">
        <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();_toggleCalendarAddMenu()">+ افزودن <span style="font-size:9px">⌄</span></button>
        ${_calendarAddMenuHtml()}
      </div>
    </div>
    <div class="todo-calendar-toolbar" style="margin-top:12px;margin-bottom:0">
      <div class="todo-calendar-toolbar-row">
        <div class="todo-calendar-mode-row">
          <label class="todo-overview-select" title="نمای تقویم">
            <span>نمای تقویم</span>
            <select onchange="_setTodoViewMode(this.value)" aria-label="نمای تقویم">
              ${option('week','هفته')}
              ${option('month','ماه')}
              ${option('year','سال')}
            </select>
          </label>
        </div>
        <div class="todo-calendar-nav-row">
          <button class="btn btn-ghost btn-sm" onclick="_todoCalendarShift(-1)">قبلی</button>
          <button class="btn btn-ghost btn-sm" onclick="_todoCalendarToday()">امروز</button>
          <button class="btn btn-ghost btn-sm" onclick="_todoCalendarShift(1)">بعدی</button>
        </div>
      </div>
      <div class="todo-calendar-search-row">
        <div class="todo-calendar-search-box ${(_todoCalendarSearchOpen || _todoCalendarSearch) ? 'open' : ''}">
          <button type="button" class="btn btn-ghost btn-sm todo-calendar-search-trigger ${_todoCalendarSearch ? 'active' : ''}" onpointerdown="event.preventDefault();_toggleTodoCalendarSearch(event)" onclick="return false" title="جستجو" aria-label="جستجو">🔍</button>
          <input class="input" id="todo-calendar-search" value="${escapeHtml(_todoCalendarSearch)}" onfocus="_openTodoCalendarSearch()" onblur="_maybeCloseTodoCalendarSearch()" oninput="_setTodoCalendarSearch(this.value)" placeholder="جستجوی کار یا مناسبت..." style="min-width:220px;max-width:360px;height:38px">
          ${_todoCalendarSearchResultsHtml()}
        </div>
        <label class="todo-calendar-repeat-toggle" style="display:flex;align-items:center;gap:6px;color:var(--text2);font-size:12px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;padding:8px 10px">
          <input type="checkbox" ${_todoCalendarShowRepeats?'checked':''} onchange="_toggleTodoCalendarRepeats(this.checked)">
          نمایش تکرارها
        </label>
      </div>
      ${_todoCalendarDataFilterChipsHtml()}
    </div>
  </div>`;
}


function _todoMiniOccasionHtml(e) {
  const meta = _todoEventTypeMeta(e.type);
  const color = e._reminder ? '#f59e0b' : (e.category === 'religious' ? '#34d399' : e.category === 'global' ? '#60a5fa' : meta.color);
  const label = e._reminder ? 'یادآور' : e.category === 'official' ? 'تعطیل رسمی' : e.category === 'religious' ? 'مذهبی' : e.category === 'global' ? 'جهانی' : meta.label;
  return `<div class="todo-mini-occasion" title="${escapeHtml(label)} — ${escapeHtml(e.title)}"
    style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:${color}18;border-right:3px solid ${color}">
    <span style="font-size:11px;line-height:1;flex-shrink:0">${e._reminder?'🔔':meta.icon}</span>
    <span style="font-size:10px;color:${color};font-weight:800;flex-shrink:0">${escapeHtml(label)}</span>
    <span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(e.title)}</span>
  </div>`;
}


function _todoMiniBirthdayHtml(b) {
  return `<div class="todo-mini-birthday" title="تولد ${escapeHtml(b.name)}" style="display:flex;align-items:center;gap:5px;min-width:0;padding:4px 6px;border-radius:7px;background:rgba(236,72,153,.11);border-right:3px solid #ec4899">
    <span style="font-size:11px">🎂</span><span style="font-size:10px;color:#ec4899;font-weight:800">تولد</span>
    <span style="font-size:11px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(b.name)}</span>
  </div>`;
}


function _renderGregorianTodoCalendarView() {
  const allTasks = _todoTasksForCalendar();
  const tasks = _todoFilteredCalendarTasks(allTasks);
  const today = _todayJalaliStr();
  const todayKey = _jalaliKey(today);
  const cursorDate = _calendarDateFromJalali(_todoCalendarCursor || today);
  const byDate = new Map();
  tasks.forEach(t => {
    const arr = byDate.get(t.date_jalali) || [];
    arr.push(t);
    byDate.set(t.date_jalali, arr);
  });
  const months = ['ژانویه','فوریه','مارس','آوریل','مه','ژوئن','ژوئیه','اوت','سپتامبر','اکتبر','نوامبر','دسامبر'];
  const weekDays = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
  const selectedDate = _todoCalendarSelectedDate || today;
  const dateKey = (d) => _jalaliKey(_jalaliFromDateObj(d));
  const weekStart = (d) => {
    const start = new Date(d);
    start.setDate(d.getDate() - ((d.getDay() + 1) % 7));
    return start;
  };
  const weekCells = Array.from({ length: 7 }, (_,i) => {
    const d = weekStart(cursorDate);
    d.setDate(d.getDate() + i);
    const j = _jalaliFromDateObj(d);
    const [jy,jm,jd] = _jalaliParse(j);
    return [jy,jm,jd];
  });
  const stats = _todoCalendarStats(tasks, weekCells);
  const statChip = (label, value, color='var(--text)') => `<div style="background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:92px">
    <div style="font-size:10px;color:var(--text3);margin-bottom:3px">${label}</div>
    <div style="font-size:16px;font-weight:900;color:${color}">${value}</div>
  </div>`;
  const listPreview = (title, list, empty) => `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:10px">
    <div style="font-size:12px;font-weight:900;color:var(--text);margin-bottom:8px">${title}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${list.slice(0,5).map(_todoMiniEventHtml).join('') || `<span style="font-size:11px;color:var(--text3)">${empty}</span>`}</div>
  </div>`;
  const mobileRangeList = (title, list, rawList = list) => {
    const sorted = [...rawList].sort((a,b) => a._key - b._key || (a.time||'').localeCompare(b.time||''));
    const filterNames = { all:'همه', urgent:'فوری', open:'انجام نشده', sessions:'جلسات', habits:'عادت‌ها', goals:'اهداف' };
    const filterHint = !sorted.length && rawList.length && _todoCalendarFilter !== 'all'
      ? `<div style="font-size:12px;color:var(--amber);line-height:1.8;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.22);border-radius:10px;padding:9px">
          فیلتر «${filterNames[_todoCalendarFilter] || _todoCalendarFilter}» فعال است.
          <button class="btn btn-primary btn-sm" onclick="_setTodoCalendarFilter('all')" style="height:30px;margin-top:8px;width:100%;justify-content:center">نمایش همه</button>
        </div>` : '';
    return `<div class="todo-calendar-mobile-range-list">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <b style="font-size:12px;color:var(--text)">${title}</b>
        <span style="font-size:11px;color:var(--text3)">${fa(sorted.length)} کار</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">${sorted.map(_todoMiniEventHtml).join('') || filterHint || '<span style="font-size:11px;color:var(--text3)">در این بازه کاری ثبت نشده است.</span>'}</div>
    </div>`;
  };
  const dayCard = (dateObj, opts = {}) => {
    const date = _jalaliFromDateObj(dateObj);
    const list = byDate.get(date) || [];
    const isToday = _jalaliKey(date) === todayKey;
    const isSelected = date === selectedDate;
    const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6;
    const heat = _todoCalendarHeat(list);
    const birthdays = _todoCalendarBirthdays(date);
    const events = _todoCalendarEvents(date);
    const sessions = _todoCalendarSessions(date);
    const habits = _todoCalendarHabits(date);
    const paymentReminders = _todoCalendarPaymentReminders(date);
    const keyEvents = _todoCalendarKeyEvents(date);
    const officialHolidays = _todoOfficialHolidaysForDate(date);
    const isOfficialDay = officialHolidays.length > 0 || dateObj.getDay() === 5;
    const calendarItemsCount = list.length + birthdays.length + events.length + sessions.length + habits.length + paymentReminders.length + keyEvents.length;
    const hasNote = !!(_db.todo_day_notes && _db.todo_day_notes[date]);
    const hasRepeat = list.some(t => (t.repeat && t.repeat !== 'none') || t._repeatPreview);
    const doneCount = list.filter(t => t.done).length;
    const remain = Math.max(0, list.length - doneCount);
    const visibleCount = _todoViewMode === 'week' ? 6 : 2;
    const shownCalendarCount = Math.min(events.length,_todoViewMode==='week'?3:1) + Math.min(birthdays.length,_todoViewMode==='week'?2:1) + Math.min(sessions.length,_todoViewMode==='week'?2:1) + Math.min(habits.length,_todoViewMode==='week'?2:1) + Math.min(paymentReminders.length,_todoViewMode==='week'?2:1) + Math.min(keyEvents.length,_todoViewMode==='week'?2:1) + Math.min(list.length,visibleCount);
    const hiddenCalendarCount = Math.max(0,calendarItemsCount-shownCalendarCount);
    const faded = opts.faded ? '.38' : '1';
    return `<div class="todo-day-card" onclick="_openTodoDayPopover('${date}')" ondragover="event.preventDefault()" ondrop="_todoDropOnDate(event,'${date}')"
      style="min-height:${calendarItemsCount ? (_todoViewMode==='week'?'154px':'96px') : (_todoViewMode==='week'?'76px':'58px')};padding:8px;border:1px solid ${isSelected?'var(--accent2)':isToday?'var(--accent2)':isOfficialDay?'rgba(255,107,107,.55)':isWeekend?'rgba(96,165,250,.30)':heat.border};border-top:${isToday?'3px solid var(--accent2)':isSelected?'3px solid var(--accent2)':isOfficialDay?'3px solid var(--red)':'1px solid '+(isWeekend?'rgba(96,165,250,.30)':heat.border)};border-radius:10px;background:${isSelected?'rgba(124,106,247,.18)':isToday?'rgba(124,106,247,.16)':isOfficialDay?'rgba(255,107,107,.075)':isWeekend?'rgba(96,165,250,.055)':heat.bg};opacity:${faded};overflow:hidden;cursor:pointer">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:${calendarItemsCount?'7px':'0'}">
        <div>
          <div style="font-size:12px;color:${isOfficialDay?'var(--red)':isToday||isSelected?'var(--accent2)':isWeekend?'#60a5fa':'var(--text3)'};font-weight:900">${dateObj.getDate()} ${isToday?'<span style="font-size:9px;background:rgba(124,106,247,.22);border-radius:999px;padding:1px 5px;margin-right:3px">امروز</span>':''} ${isOfficialDay?'🔴':''} ${birthdays.length?'🎂':''} ${events.map(e=>e._reminder?'🔔':_todoEventTypeMeta(e.type).icon).join('')} ${keyEvents.length?'⭐':''} ${hasRepeat?'🔁':''} ${hasNote?'📝':''}</div>
          ${list.length ? `<div style="font-size:9px;color:var(--text3);margin-top:3px">${fa(list.length)} کار · ${fa(doneCount)} انجام · ${fa(remain)} مانده</div>` : ''}
        </div>
        ${list.length ? `<span title="${escapeHtml(heat.label)}" style="font-size:10px;color:var(--text3);background:rgba(255,255,255,.05);border-radius:999px;padding:2px 6px">${fa(list.length)}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${events.slice(0, _todoViewMode==='week'?3:1).map(_todoMiniOccasionHtml).join('')}
        ${birthdays.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniBirthdayHtml).join('')}
        ${sessions.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniSessionHtml).join('')}
        ${habits.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniHabitHtml).join('')}
        ${paymentReminders.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniReminderHtml).join('')}
        ${keyEvents.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniKeyEventHtml).join('')}
        ${list.slice(0, visibleCount).map(_todoMiniEventHtml).join('')}
        ${hiddenCalendarCount ? `<button class="todo-more-badge" onclick="event.stopPropagation();_openTodoDayPopover('${date}')" title="نمایش همه آیتم‌ها">+${fa(hiddenCalendarCount)}</button>` : ''}
      </div>
    </div>`;
  };

  if (_todoViewMode === 'week') {
    const start = weekStart(cursorDate);
    const cells = Array.from({length:7}, (_,i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    const weekKeys = new Set(cells.map(dateKey));
    const prev = new Date(start); prev.setDate(start.getDate() - 7);
    const prevKeys = new Set(Array.from({length:7}, (_,i) => { const d = new Date(prev); d.setDate(prev.getDate() + i); return dateKey(d); }));
    const weekPerf = _todoRangePerformance(allTasks, weekKeys, prevKeys);
    const weekTasks = tasks.filter(t => weekKeys.has(t._key));
    const rawWeekTasks = allTasks.filter(t => weekKeys.has(t._key));
    return `<div class="todo-calendar-week-layout">
      <div class="todo-calendar-week-grid">
        ${cells.map((d,i)=>`<div><div class="todo-calendar-week-day-label" style="font-size:11px;color:${i===0||i===6?'#60a5fa':'var(--text3)'};font-weight:800;margin-bottom:6px;text-align:center">${weekDays[i]}</div>${dayCard(d)}</div>`).join('')}
      </div>
      ${mobileRangeList('لیست کارهای این هفته', weekTasks, rawWeekTasks)}
      <div class="todo-calendar-side">
        ${_todoPerformanceReportHtml('گزارش عملکرد هفته', weekPerf)}
        ${listPreview('کارهای امروز', stats.todayTasks, 'امروز کاری ندارید.')}
        ${listPreview('عقب‌افتاده‌ها', stats.overdue, 'کار عقب‌افتاده‌ای نیست.')}
        ${listPreview('نزدیک‌ترین موعد', stats.nearest ? [stats.nearest] : [], 'موعد نزدیکی وجود ندارد.')}
      </div>
    </div>`;
  }

  if (_todoViewMode === 'month') {
    const year = cursorDate.getFullYear();
    const month = cursorDate.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = (first.getDay() + 1) % 7; i > 0; i--) { const d = new Date(year, month, 1 - i); cells.push({ d, faded:true }); }
    for (let day = 1; day <= daysInMonth; day++) cells.push({ d:new Date(year, month, day), faded:false });
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length - 1].d;
      const d = new Date(last); d.setDate(last.getDate() + 1);
      cells.push({ d, faded:true });
    }
    const monthKeys = new Set(Array.from({length:daysInMonth}, (_,i) => dateKey(new Date(year, month, i + 1))));
    const prevDays = new Date(year, month, 0).getDate();
    const prevKeys = new Set(Array.from({length:prevDays}, (_,i) => dateKey(new Date(year, month - 1, i + 1))));
    const monthTasks = tasks.filter(t => monthKeys.has(t._key));
    const rawMonthTasks = allTasks.filter(t => monthKeys.has(t._key));
    return `<div class="todo-calendar-month-layout">
      <div>
        ${_todoPerformanceReportHtml('گزارش عملکرد ماه', _todoRangePerformance(allTasks, monthKeys, prevKeys))}
        <div class="todo-calendar-month-grid">
          ${weekDays.map(w=>`<div style="font-size:10px;color:var(--text3);font-weight:700;text-align:center;padding-bottom:2px">${w}</div>`).join('')}
          ${cells.map(x=>dayCard(x.d,{faded:x.faded})).join('')}
        </div>
        ${mobileRangeList('لیست کارهای این ماه', monthTasks, rawMonthTasks)}
      </div>
    </div>`;
  }

  const year = cursorDate.getFullYear();
  const yearKeys = new Set();
  for (let month = 0; month < 12; month++) {
    const days = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= days; day++) yearKeys.add(dateKey(new Date(year, month, day)));
  }
  const prevYearKeys = new Set();
  for (let month = 0; month < 12; month++) {
    const days = new Date(year - 1, month + 1, 0).getDate();
    for (let day = 1; day <= days; day++) prevYearKeys.add(dateKey(new Date(year - 1, month, day)));
  }
  const monthCards = Array.from({length:12}, (_,month) => {
    const days = new Date(year, month + 1, 0).getDate();
    let count = 0;
    const dayDots = Array.from({length:days}, (_,idx) => {
      const d = new Date(year, month, idx + 1);
      const date = _jalaliFromDateObj(d);
      const list = byDate.get(date) || [];
      count += list.length;
      const heat = _todoCalendarHeat(list);
      const birthdays = _todoCalendarBirthdays(date);
      const events = _todoCalendarEvents(date);
      const officialHolidays = _todoOfficialHolidaysForDate(date);
      const isSelected = date === selectedDate;
      return `<button onclick="_openTodoWeekFromDate('${date}')" title="${d.getDate()} ${months[month]} ${year} · ${fa(list.length)} کار"
        style="width:14px;height:14px;border-radius:3px;border:1px solid ${isSelected?'var(--accent2)':officialHolidays.length?'var(--red)':heat.border};background:${officialHolidays.length?'rgba(255,107,107,.18)':heat.bg};padding:0;cursor:pointer;position:relative">
          ${birthdays.length?'<span style="position:absolute;inset:auto -3px -7px auto;font-size:8px">🎂</span>':''}
          ${events.length?`<span style="position:absolute;inset:-8px auto auto -3px;font-size:8px">${events[0]._reminder?'🔔':_todoEventTypeMeta(events[0].type).icon}</span>`:''}
        </button>`;
    }).join('');
    return `<div class="todo-calendar-year-card">
      <button onclick="_tpTodoCalCursor('${_jalaliFromDateObj(new Date(year, month, 1))}','month')"
        style="all:unset;display:flex;justify-content:space-between;align-items:center;width:100%;cursor:pointer;margin-bottom:8px">
        <b style="font-size:13px;color:var(--text)">${months[month]}</b>
        <span style="font-size:11px;color:var(--text3)">${fa(count)} کار</span>
      </button>
      <div class="todo-calendar-year-dots">${dayDots}</div>
    </div>`;
  }).join('');
  const yearTasks = tasks.filter(t => yearKeys.has(t._key));
  const rawYearTasks = allTasks.filter(t => yearKeys.has(t._key));
  return `<div class="todo-calendar-year-head" style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 10px">
    <div style="font-size:15px;font-weight:800;color:var(--text)">${year}</div>
    <div class="todo-calendar-legend" style="display:flex;gap:8px;font-size:11px;color:var(--text3);align-items:center;flex-wrap:wrap">
      <span>Light</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.38)"></span>
      <span>Medium</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(245,158,11,.13);border:1px solid rgba(245,158,11,.42)"></span>
      <span>Busy</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.48)"></span>
      <span>Heavy</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.55)"></span>
    </div>
  </div>
  ${_todoPerformanceReportHtml('گزارش عملکرد سال', _todoRangePerformance(allTasks, yearKeys, prevYearKeys))}
  <div class="todo-calendar-year-layout">
    <div class="todo-calendar-year-grid">${monthCards}</div>
    ${mobileRangeList('لیست کارهای امسال', yearTasks, rawYearTasks)}
  </div>`;
}


function _renderTodoCalendarView() {
  if (DateService.isGregorian()) return _renderGregorianTodoCalendarView();
  const allTasks = _todoTasksForCalendar();
  const tasks = _todoFilteredCalendarTasks(allTasks);
  const today = _todayJalaliStr();
  const todayKey = _jalaliKey(today);
  const [cy, cm, cd] = _jalaliParse(_todoCalendarCursor || today);
  const byDate = new Map();
  tasks.forEach(t => {
    const arr = byDate.get(t.date_jalali) || [];
    arr.push(t);
    byDate.set(t.date_jalali, arr);
  });

  const weekStartFromCursor = () => {
    const [gy,gm,gd] = jalaliToGregorian(cy,cm,cd);
    const dow = new Date(gy,gm-1,gd).getDay();
    const daysFromSaturday = (dow + 1) % 7;
    const start = _addDays(cy,cm,cd,-daysFromSaturday);
    return Array.from({length:7}, (_,i) => _addDays(start[0],start[1],start[2],i));
  };
  const activeWeekCells = weekStartFromCursor();
  const stats = _todoCalendarStats(tasks, activeWeekCells);

  const statChip = (label, value, color='var(--text)') => `<div style="background:rgba(255,255,255,.035);border:1px solid var(--border);border-radius:10px;padding:8px 10px;min-width:92px">
    <div style="font-size:10px;color:var(--text3);margin-bottom:3px">${label}</div>
    <div style="font-size:16px;font-weight:900;color:${color}">${value}</div>
  </div>`;

  const listPreview = (title, list, empty) => `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:10px">
    <div style="font-size:12px;font-weight:900;color:var(--text);margin-bottom:8px">${title}</div>
    <div style="display:flex;flex-direction:column;gap:6px">${list.slice(0,5).map(_todoMiniEventHtml).join('') || `<span style="font-size:11px;color:var(--text3)">${empty}</span>`}</div>
  </div>`;

  const mobileRangeList = (title, list, rawList = list) => {
    const sorted = [...rawList].sort((a,b) => a._key - b._key || (a.time||'').localeCompare(b.time||''));
    const filterNames = { all:'همه', urgent:'فوری', open:'انجام نشده', sessions:'جلسات', habits:'عادت‌ها', goals:'اهداف' };
    const filterHint = !sorted.length && rawList.length && _todoCalendarFilter !== 'all'
      ? `<div style="font-size:12px;color:var(--amber);line-height:1.8;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.22);border-radius:10px;padding:9px">
          فیلتر «${filterNames[_todoCalendarFilter] || _todoCalendarFilter}» فعال است و کارهای این بازه را پنهان کرده.
          <button class="btn btn-primary btn-sm" onclick="_setTodoCalendarFilter('all')" style="height:30px;margin-top:8px;width:100%;justify-content:center">نمایش همه کارها</button>
        </div>`
      : '';
    return `<div class="todo-calendar-mobile-range-list">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px">
        <b style="font-size:12px;color:var(--text)">${title}</b>
        <span style="font-size:11px;color:var(--text3)">${fa(sorted.length)} کار</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${sorted.map(_todoMiniEventHtml).join('') || filterHint || '<span style="font-size:11px;color:var(--text3)">در این بازه کاری ثبت نشده است.</span>'}
      </div>
    </div>`;
  };

  const selectedDate = _todoCalendarSelectedDate || today;
  const dayCard = (jy,jm,jd, opts={}) => {
    const date = _formatJalali(jy,jm,jd);
    const list = byDate.get(date) || [];
    const isToday = _jalaliKey(date) === todayKey;
    const isSelected = date === selectedDate;
    const isFriday = opts.weekIndex === 6;
    const heat = _todoCalendarHeat(list);
    const birthdays = _todoCalendarBirthdays(date);
    const events = _todoCalendarEvents(date);
    const sessions = _todoCalendarSessions(date);
    const habits = _todoCalendarHabits(date);
    const paymentReminders = _todoCalendarPaymentReminders(date);
    const keyEvents = _todoCalendarKeyEvents(date);
    const officialHolidays = _todoOfficialHolidaysForDate(date);
    const isOfficialDay = isFriday || officialHolidays.length > 0;
    const calendarItemsCount = list.length + birthdays.length + events.length + sessions.length + habits.length + paymentReminders.length + keyEvents.length;
    const hasNote = !!(_db.todo_day_notes && _db.todo_day_notes[date]);
    const hasRepeat = list.some(t => t.repeat && t.repeat !== 'none' || t._repeatPreview);
    const faded = opts.faded ? '.38' : '1';
    const doneCount = list.filter(t => t.done).length;
    const remain = Math.max(0, list.length - doneCount);
    const visibleCount = _todoViewMode === 'week' ? 6 : 2;
    const shownCalendarCount = Math.min(events.length,_todoViewMode==='week'?3:1) + Math.min(birthdays.length,_todoViewMode==='week'?2:1) + Math.min(sessions.length,_todoViewMode==='week'?2:1) + Math.min(habits.length,_todoViewMode==='week'?2:1) + Math.min(paymentReminders.length,_todoViewMode==='week'?2:1) + Math.min(keyEvents.length,_todoViewMode==='week'?2:1) + Math.min(list.length,visibleCount);
    const hiddenCalendarCount = Math.max(0,calendarItemsCount-shownCalendarCount);
    let shownCount = 0;
    const grouped = ['صبح','ظهر','عصر','بدون ساعت'].map(bucket => {
      const items = list.filter(t => _todoTimeBucket(t) === bucket).filter(() => shownCount++ < visibleCount);
      if (!items.length) return '';
      return `<div style="display:flex;flex-direction:column;gap:4px">
        ${_todoViewMode === 'week' ? `<div style="font-size:9px;color:var(--text3);font-weight:800;margin-top:2px">${bucket}</div>` : ''}
        ${items.map(_todoMiniEventHtml).join('')}
      </div>`;
    }).join('');
    return `<div class="todo-day-card" onclick="_openTodoDayPopover('${date}')" ondragover="event.preventDefault()" ondrop="_todoDropOnDate(event,'${date}')"
      style="min-height:${calendarItemsCount ? (_todoViewMode==='week'?'154px':'96px') : (_todoViewMode==='week'?'76px':'58px')};padding:8px;border:1px solid ${isSelected?'var(--accent2)':isToday?'var(--accent2)':isOfficialDay?'rgba(255,107,107,.55)':heat.border};border-top:${isToday?'3px solid var(--accent2)':isSelected?'3px solid var(--accent2)':isOfficialDay?'3px solid var(--red)':'1px solid '+heat.border};border-radius:10px;background:${isSelected?'rgba(124,106,247,.18)':isToday?'rgba(124,106,247,.16)':isOfficialDay?'rgba(255,107,107,.075)':heat.bg};opacity:${faded};overflow:hidden;cursor:pointer">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;margin-bottom:${calendarItemsCount?'7px':'0'}">
        <div>
          <div style="font-size:12px;color:${isOfficialDay?'var(--red)':isToday||isSelected?'var(--accent2)':'var(--text3)'};font-weight:900">${fa(jd)} ${isToday?'<span style="font-size:9px;background:rgba(124,106,247,.22);border-radius:999px;padding:1px 5px;margin-right:3px">امروز</span>':''} ${isOfficialDay?'🔴':''} ${birthdays.length?'🎂':''} ${events.map(e=>e._reminder?'🔔':_todoEventTypeMeta(e.type).icon).join('')} ${keyEvents.length?'⭐':''} ${hasRepeat?'🔁':''} ${hasNote?'📝':''}</div>
          ${list.length ? `<div style="font-size:9px;color:var(--text3);margin-top:3px">${fa(list.length)} کار · ${fa(doneCount)} انجام · ${fa(remain)} مانده</div>` : ''}
        </div>
        ${list.length ? `<span title="${escapeHtml(heat.label)}" style="font-size:10px;color:var(--text3);background:rgba(255,255,255,.05);border-radius:999px;padding:2px 6px">${fa(list.length)}</span>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${events.slice(0, _todoViewMode==='week'?3:1).map(_todoMiniOccasionHtml).join('')}
        ${birthdays.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniBirthdayHtml).join('')}
        ${sessions.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniSessionHtml).join('')}
        ${habits.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniHabitHtml).join('')}
        ${paymentReminders.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniReminderHtml).join('')}
        ${keyEvents.slice(0, _todoViewMode==='week'?2:1).map(_todoMiniKeyEventHtml).join('')}
        ${_todoViewMode === 'week' ? grouped : list.slice(0, visibleCount).map(_todoMiniEventHtml).join('')}
        ${hiddenCalendarCount ? `<button class="todo-more-badge" onclick="event.stopPropagation();_openTodoDayPopover('${date}')" title="نمایش همه آیتم‌ها">+${fa(hiddenCalendarCount)}</button>` : ''}
      </div>
    </div>`;
  };

  const weekDays = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];
  const header = '';

  if (_todoViewMode === 'week') {
    const cells = activeWeekCells;
    const weekKeys = new Set(cells.map(d => _jalaliKey(_formatJalali(d[0],d[1],d[2]))));
    const prevWeekStart = _addDays(cells[0][0], cells[0][1], cells[0][2], -7);
    const prevWeekKeys = _todoDateKeysBetween(prevWeekStart, 7);
    const weekPerf = _todoRangePerformance(allTasks, weekKeys, prevWeekKeys);
    const weekTasks = tasks.filter(t => weekKeys.has(t._key));
    const rawWeekTasks = allTasks.filter(t => weekKeys.has(t._key));
    const nearest = stats.nearest ? [stats.nearest] : [];
    return header + `<div class="todo-calendar-week-layout">
      <div class="todo-calendar-week-grid">
        ${cells.map((d,i)=>`<div><div class="todo-calendar-week-day-label" style="font-size:11px;color:${i===6?'var(--red)':'var(--text3)'};font-weight:800;margin-bottom:6px;text-align:center">${weekDays[i]}</div>${dayCard(d[0],d[1],d[2],{weekIndex:i})}</div>`).join('')}
      </div>
      ${mobileRangeList('لیست کارهای این هفته', weekTasks, rawWeekTasks)}
      <div class="todo-calendar-side">
        ${listPreview('کارهای امروز', stats.todayTasks, 'امروز کاری ندارید.')}
        ${listPreview('عقب‌افتاده‌ها', stats.overdue, 'کار عقب‌افتاده‌ای نیست.')}
        ${listPreview('نزدیک‌ترین موعد', nearest, 'موعد نزدیکی وجود ندارد.')}
        <div class="todo-calendar-report-section">${_todoPerformanceReportHtml('گزارش عملکرد هفته', weekPerf)}</div>
      </div>
    </div>`;
  }

  if (_todoViewMode === 'month') {
    const daysInMonth = _jalaliDaysInMonth(cy, cm);
    const [fgY,fgM,fgD] = jalaliToGregorian(cy,cm,1);
    const firstDow = new Date(fgY,fgM-1,fgD).getDay();
    const leading = (firstDow + 1) % 7;
    const cells = [];
    for (let i=leading; i>0; i--) cells.push({d:_addDays(cy,cm,1,-i), faded:true});
    for (let d=1; d<=daysInMonth; d++) cells.push({d:[cy,cm,d], faded:false});
    while (cells.length % 7 !== 0) {
      const last = cells[cells.length-1].d;
      cells.push({d:_addDays(last[0],last[1],last[2],1), faded:true});
    }
    const monthTasks = tasks.filter(t => { const [y,m] = _jalaliParse(t.date_jalali); return y === cy && m === cm; });
    const rawMonthTasks = allTasks.filter(t => { const [y,m] = _jalaliParse(t.date_jalali); return y === cy && m === cm; });
    const prevMonth = cm === 1 ? [cy - 1, 12] : [cy, cm - 1];
    const monthPerf = _todoRangePerformance(allTasks, _todoMonthKeys(cy, cm), _todoMonthKeys(prevMonth[0], prevMonth[1]));
    return header + `<div class="todo-calendar-month-layout">
      <div>
        <div class="todo-calendar-month-grid">
          ${weekDays.map(w=>`<div style="font-size:10px;color:var(--text3);font-weight:700;text-align:center;padding-bottom:2px">${w}</div>`).join('')}
          ${cells.map((x,i)=>dayCard(x.d[0],x.d[1],x.d[2],{faded:x.faded,weekIndex:i%7})).join('')}
        </div>
        ${mobileRangeList('لیست کارهای این ماه', monthTasks, rawMonthTasks)}
        <div class="todo-calendar-report-section">${_todoPerformanceReportHtml('گزارش عملکرد ماه', monthPerf)}</div>
      </div>
    </div>`;
  }

  const yearMonthCounts = new Map();
  tasks.forEach(t => {
    const [y,m] = _jalaliParse(t.date_jalali);
    if (y === cy) yearMonthCounts.set(m, (yearMonthCounts.get(m) || 0) + 1);
  });
  const monthCards = Array.from({length:12}, (_,i) => {
    const jm = i + 1;
    const daysInMonth = _jalaliDaysInMonth(cy, jm);
    const dayDots = Array.from({length:daysInMonth}, (_,idx) => {
      const date = _formatJalali(cy,jm,idx+1);
      const list = byDate.get(date) || [];
      const heat = _todoCalendarHeat(list);
      const birthdays = _todoCalendarBirthdays(date);
      const events = _todoCalendarEvents(date);
      const officialHolidays = _todoOfficialHolidaysForDate(date);
      const isSelected = date === selectedDate;
      return `<button onclick="_openTodoWeekFromDate('${date}')" title="${DateService.disp(date)} · ورود به هفته · ${fa(list.length)} کار"
        style="width:14px;height:14px;border-radius:3px;border:1px solid ${isSelected?'var(--accent2)':officialHolidays.length?'var(--red)':heat.border};background:${officialHolidays.length?'rgba(255,107,107,.18)':heat.bg};padding:0;cursor:pointer;position:relative">
          ${birthdays.length?'<span style="position:absolute;inset:auto -3px -7px auto;font-size:8px">🎂</span>':''}
          ${events.length?`<span style="position:absolute;inset:-8px auto auto -3px;font-size:8px">${events[0]._reminder?'🔔':_todoEventTypeMeta(events[0].type).icon}</span>`:''}
        </button>`;
    }).join('');
    return `<div class="todo-calendar-year-card">
      <button onclick="_tpTodoCalCursor('${_formatJalali(cy,jm,1)}','month')"
        style="all:unset;display:flex;justify-content:space-between;align-items:center;width:100%;cursor:pointer;margin-bottom:8px">
        <b style="font-size:13px;color:var(--text)">${JMONTHS[i]}</b>
        <span style="font-size:11px;color:var(--text3)">${fa(yearMonthCounts.get(jm) || 0)} کار</span>
      </button>
      <div class="todo-calendar-year-dots">${dayDots}</div>
    </div>`;
  }).join('');
  const yearTasks = tasks.filter(t => { const [y] = _jalaliParse(t.date_jalali); return y === cy; });
  const rawYearTasks = allTasks.filter(t => { const [y] = _jalaliParse(t.date_jalali); return y === cy; });
  const yearPerf = _todoRangePerformance(allTasks, _todoYearKeys(cy), _todoYearKeys(cy - 1));
  return header + `<div class="todo-calendar-year-head" style="display:flex;align-items:center;justify-content:space-between;margin:2px 0 10px">
    <div style="font-size:15px;font-weight:800;color:var(--text)">سال ${fa(cy)}</div>
    <div class="todo-calendar-legend" style="display:flex;gap:8px;font-size:11px;color:var(--text3);align-items:center;flex-wrap:wrap">
      <span>سبک</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.38)"></span>
      <span>متوسط</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(245,158,11,.13);border:1px solid rgba(245,158,11,.42)"></span>
      <span>شلوغ</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(249,115,22,.14);border:1px solid rgba(249,115,22,.48)"></span>
      <span>سنگین</span><span style="width:14px;height:14px;border-radius:3px;background:rgba(239,68,68,.16);border:1px solid rgba(239,68,68,.55)"></span>
    </div>
  </div>
  <div class="todo-calendar-year-layout">
    <div class="todo-calendar-year-grid">${monthCards}</div>
    ${mobileRangeList('لیست کارهای امسال', yearTasks, rawYearTasks)}
  </div>
  <div class="todo-calendar-report-section">${_todoPerformanceReportHtml('گزارش عملکرد سال', yearPerf)}</div>`;
}


async function renderCalendar() {
  _todosInit();
  if (!['week','month','year'].includes(_todoViewMode)) {
    _todoViewMode = 'month';
    localStorage.setItem('tp_todo_view_mode', _todoViewMode);
  }
  updateTopbarActions('');
  setContent(`${_todoCalendarResponsiveCss()}<div class="todo-calendar-shell">${_calendarPageHeaderHtml()}${_renderTodoCalendarView()}</div>`);
  _checkTodoReminders();
}


function _todoShowMore(key) {
  _todoListShown[key] = (_todoListShown[key] || TODO_LIST_CHUNK) + TODO_LIST_CHUNK;
  renderTodoList({ skipMaintenance: true });
}

function renderTodoList(options = {}) {
  _todosInit();
  const skipMaintenance = options.skipMaintenance === true;
  if (!skipMaintenance) _todoListShown = {};
  if (_todoViewMode !== 'list') {
    _todoViewMode = 'list';
    localStorage.setItem('tp_todo_view_mode', _todoViewMode);
  }

  // بایگانی/ترمیم خودکار: کارهایی که روز قبل done شدن رو archive کن؛
  // تکراری‌های گیرکرده از روز قبل را هم به دوره بعدی همان روز انجام منتقل کن.
  const _todayStr = _todayJalaliStr();
  const _todayK = _jalaliKey(_todayStr);
  let _archiveChanged = false;
  if (!skipMaintenance) {
  const duplicateCleanupCount = _dedupeOpenTodos();
  _archiveChanged = duplicateCleanupCount > 0;
  _db.todos.forEach(t => {
    if (t.done && !t.archived && t.repeat && t.repeat !== 'none' && t.done_at) {
      const parts = _jalaliFromInstant(t.done_at);
      if (!parts) return;
      const [dy,dm,dd] = parts;
      const doneDayStr = _formatJalali(dy,dm,dd);
      const doneDayKey = _jalaliKey(doneDayStr);
      if (doneDayKey < _todayK) {
        _db.todos.push({
          ...t,
          id: _allocateTodoId(),
          done: true,
          archived: true,
          repeat: 'none',
          _snapshot: true,
        });
        t.archived = false;
        t.done = false;
        t.done_at = null;
        t.updated_at = new Date().toISOString();
        _advanceTodoDate(t, doneDayStr);
        _archiveChanged = true;
      }
    }
    if (t.done && !t.archived && (!t.repeat || t.repeat === 'none') && t.done_at) {
      const parts = _jalaliFromInstant(t.done_at);
      if (!parts) return;
      const [dy,dm,dd] = parts;
      const doneDayKey = _jalaliKey(_formatJalali(dy,dm,dd));
      if (doneDayKey < _todayK) { t.archived = true; _archiveChanged = true; }
    }
    if (!t.done && !t.archived && _isTodoRecurring(t)) {
      const scheduledKey = _jalaliKey(_todoScheduledDate(t) || '');
      if (scheduledKey && scheduledKey < _todayK && _todoHasCatchUpOnScheduledDay(t)) {
        _setRecurringTodoOnOrAfterToday(t);
        t.updated_at = new Date().toISOString();
        _archiveChanged = true;
      }
    }
  });
  if (_archiveChanged) {
    if (_isTeamGuest()) {
      // هم‌تیمی صاحب واقعیِ این دیتا نیست: تغییرات بایگانیِ خودکار فقط باید
      // در همین حافظه‌ی محلی اعمال بشن تا نمایش لحظه‌ای درست باشه، بدون اینکه
      // با _save()/_syncToServer() چیزی روی سرور نوشته بشه. اگر اینجا سینک می‌شد،
      // چون _db محلیِ هم‌تیمی ممکنه هنوز کارهای تازه‌ی مدیر رو نگرفته باشه،
      // همون snapshot ناقص با یه timestamp «جدیدتر» جای دیتای واقعی مدیر می‌نشست
      // و کارهای تازه از سرور پاک می‌شدن.
    } else {
      _save(); _syncToServer();
    }
  }
  }

  if (!skipMaintenance) {
    if (_isTeamGuest() && _todoActiveTab === 'staff' && !_todoStaffTabExplicit) _todoActiveTab = 'mine';
    if (_isTeamGuest() && _todoActiveTab !== 'mine' && !(_todoActiveTab === 'staff' && _todoCanOpenStaffTasksTab())) _todoActiveTab = 'mine';
    if (['my_report','report'].includes(_todoActiveTab)) _todoActiveTab = 'mine';
    updateTopbarActions(_todoTopbarActionsHtml());
  }
  if (_todoActiveTab === 'staff') {
    setContent(`${_todoCalendarResponsiveCss()}<div class="todo-calendar-shell">${_todoStaffDashboardHtml()}</div>`);
    setTimeout(_renderTodoStaffFilteredList, 20);
    return;
  }
  if (_todoActiveTab === 'report' || _todoActiveTab === 'my_report') {
    setContent(`${_todoCalendarResponsiveCss()}<div class="todo-calendar-shell">${_todoReportHtml(_todoActiveTab === 'my_report')}</div>`);
    return;
  }

  const todayKey = _jalaliToday();
  const today = _todayJalaliStr();

  // محاسبه کلید فردا
  const todayParts = _jalaliParse(today);
  let tomorrowStr = '';
  try {
    const gToday = jalaliToGregorian(todayParts[0], todayParts[1], todayParts[2]);
    const tmDate = new Date(gToday[0], gToday[1]-1, gToday[2]+1);
    const tmJ = gregorianToJalali(tmDate.getFullYear(), tmDate.getMonth()+1, tmDate.getDate());
    tomorrowStr = _formatJalali(tmJ[0], tmJ[1], tmJ[2]);
  } catch(e) {}
  const tomorrowKey = tomorrowStr ? _jalaliKey(tomorrowStr) : 0;

  // کارهای اصلی + occurrence/snapshot های تکمیل‌شده امروز
  const _todayKeyForFilter = _jalaliKey(_todayJalaliStr());
  const _todaySnapshots = _db.todos.filter(t => _todoCanView(t) && _todoIsMineScope(t) && t.archived && t._snapshot && _todoIsDoneToday(t, _todayKeyForFilter));
  const todos = [..._db.todos.filter(t => _todoCanView(t) && _todoIsMineScope(t) && !t.archived), ..._todaySnapshots];

  // کار عقب‌افتاده فقط مربوط به روزهای قبل است.
  // کارهای امروز حتی اگر ساعتشان رد شده باشد باید در بخش «امروز» بمانند.
  const _doneToday = (t) => _todoIsDoneToday(t, todayKey);

  const overdueTodos = todos.filter(t => _todoIsOverdue(t, todayKey) && !_doneToday(t))
    .sort((a,b) => {
      const dk = _jalaliKey(_todoScheduledDate(a)) - _jalaliKey(_todoScheduledDate(b));
      if (dk !== 0) return dk;
      return (a.time||'').localeCompare(b.time||'');
    });

  const todayTodos = todos.filter(t => {
    const scheduled = _todoScheduledDate(t);
    const scheduledKey = scheduled ? _jalaliKey(scheduled) : 0;
    return !scheduled || scheduledKey === todayKey;
  });
  const tomorrowTodos  = todos.filter(t => {
    const scheduled = _todoScheduledDate(t);
    return scheduled && tomorrowKey && _jalaliKey(scheduled) === tomorrowKey;
  });
  const lateDoneTodayTodos = todos.filter(t => {
    const scheduled = _todoScheduledDate(t);
    return _doneToday(t) && scheduled && _jalaliKey(scheduled) < todayKey;
  }).sort((a,b) => _jalaliKey(_todoScheduledDate(a)) - _jalaliKey(_todoScheduledDate(b)) || _sortByTime(a,b));
  const _afterKey = tomorrowKey || todayKey;
  const futureTodos    = todos.filter(t => {
    const scheduled = _todoScheduledDate(t);
    return scheduled && _jalaliKey(scheduled) > _afterKey;
  }).sort((a,b) => _jalaliKey(_todoScheduledDate(a))-_jalaliKey(_todoScheduledDate(b)));

  // کارهای repeat عقب‌افتاده: پیش‌نمایش نوبت بعدی فقط اگر بعد از امروز باشد.
  // نوبت امروز همان catch-up است و نباید جداگانه به «فردا» برود.
  const _repeatPreviewItems = [];
  overdueTodos.filter(t => t.repeat && t.repeat !== 'none' && !t.done).forEach(t => {
    const nextDate = _calcNextRepeatDate(t);
    if (!nextDate) return;
    const nextKey = _jalaliKey(nextDate);
    if (nextKey === tomorrowKey) {
      // اگه قبلاً نیست اضافه کن
      if (!tomorrowTodos.find(x => x.id === t.id)) {
        tomorrowTodos.push({ ...t, date_jalali: nextDate, _isRepeatPreview: true });
      }
    } else if (nextKey > (tomorrowKey || todayKey)) {
      if (!futureTodos.find(x => x.id === t.id)) {
        futureTodos.push({ ...t, date_jalali: nextDate, _isRepeatPreview: true });
        futureTodos.sort((a,b) => _jalaliKey(a.date_jalali)-_jalaliKey(b.date_jalali));
      }
    }
  });

  const pending = todayTodos.filter(t=>!t.done).length;
  const doneCnt = todayTodos.filter(t=>t.done).length;
  const completedTodayTotal = todos.filter(t => _doneToday(t)).length;
  const lateCompletedTodayCount = lateDoneTodayTodos.length;
  const progress = todayTodos.length > 0 ? Math.round(doneCnt/todayTodos.length*100) : 0;
  const activeCount = todos.filter(t => !t.done).length;
  const mainTodayTodos = todayTodos
    .filter(t => !t.done && +t.main_today_rank > 0)
    .sort((a,b) => (+a.main_today_rank || 99) - (+b.main_today_rank || 99) || _sortByTime(a,b))
    .slice(0, 3);
  const mainTodayIds = new Set(mainTodayTodos.map(t => t.id));

  const renderTodo = (t) => {
    const isOverdue = _todoIsOverdue(t);
    const priority = t.priority || 'none';
    const repeatIcon = {none:'',daily:'🔄',every2days:'↩️',weekly:'📅',monthly:'🗓',custom_weekdays:'⚙️'}[t.repeat||'none'];
    const todoMenuId = `todo-menu-${t.id}`;

    // رنگ‌بندی بر اساس اولویت و وضعیت
    let bgColor, borderColor, titleColor, leftBorder, priorityBadge = '';
    if (t.done) {
      bgColor = 'var(--bg2)'; borderColor = 'var(--border)';
      titleColor = 'var(--text3)'; leftBorder = 'transparent';
    } else if (isOverdue) {
      bgColor = 'rgba(239,68,68,.08)'; borderColor = 'rgba(239,68,68,.45)';
      titleColor = 'var(--red)'; leftBorder = 'var(--red)';
    } else if (priority === 'urgent') {
      bgColor = 'var(--bg2)'; borderColor = 'rgba(239,68,68,.25)';
      titleColor = 'var(--text)'; leftBorder = 'var(--red)';
      priorityBadge = '<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(239,68,68,.15);color:var(--red);font-weight:700;animation:urgentPulse 1.5s infinite;display:inline-block">🔥 فوری</span>';
    } else if (priority === 'high') {
      bgColor = 'var(--bg2)'; borderColor = 'rgba(245,158,11,.2)';
      titleColor = 'var(--text)'; leftBorder = 'var(--amber)';
      priorityBadge = '<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(245,158,11,.12);color:var(--amber);font-weight:600">↑ بالا</span>';
    } else if (priority === 'medium') {
      bgColor = 'var(--bg2)'; borderColor = 'var(--border2)';
      titleColor = 'var(--text)'; leftBorder = 'rgba(96,165,250,.5)';
      priorityBadge = '<span style="font-size:9px;padding:2px 7px;border-radius:4px;background:rgba(96,165,250,.1);color:#60a5fa;font-weight:600">متوسط</span>';
    } else {
      bgColor = 'var(--bg2)'; borderColor = 'var(--border2)';
      titleColor = 'var(--text)'; leftBorder = 'transparent';
    }

    return `<div data-todo-id="${t.id}" draggable="true"
      class="todo-row"
      style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;
        background:${bgColor};
        border:1px solid ${borderColor};
        border-right:3px solid ${leftBorder};
        border-radius:10px;margin-bottom:6px;opacity:${t.done?.5:1};
        cursor:default;user-select:none">
      <span class="todo-drag-handle" style="color:var(--text3);font-size:14px;cursor:grab;padding:2px 2px 0;flex-shrink:0;opacity:.35;line-height:1">⠿</span>
      <button data-todo-complete onpointerdown="_todoCompletePointerDown(event,${t.id})" onpointerup="_todoCompletePointerUp(event,${t.id})" onpointercancel="_todoCompletePointerCancel(event)" onclick="_todoCompleteClick(event,${t.id})" aria-pressed="${t.done ? 'true' : 'false'}"
        style="width:22px;height:22px;border-radius:50%;flex-shrink:0;margin-top:2px;cursor:pointer;
          border:2px solid ${t.done?'var(--green)':isOverdue||priority==='urgent'?'var(--red)':priority==='high'?'var(--amber)':'var(--border2)'};
          background:${t.done?'var(--green)':'transparent'};
          color:white;font-size:11px;font-weight:700">
        ${t.done?'✓':''}
      </button>
      <div style="flex:1;min-width:0;cursor:pointer" onclick="${_todoCanEdit(t)?`openEditTodo(${t.id})`:`_openTodoReadonly(${t.id})`}">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
          <span data-todo-title style="font-size:13px;font-weight:${t.done?'400':'600'};text-decoration:${t.done?'line-through':'none'};color:${titleColor}">
            ${escapeHtml(t.title)}
            ${repeatIcon?`<span style="font-size:10px;opacity:.6"> ${repeatIcon}</span>`:''}
          </span>
          ${priorityBadge}
          ${(()=>{
            const catMap = {clients:['👥','#f472b6'],routine:['🔄','#34d399'],general:['🌐','#60a5fa'],personal:['🧘','#a78bfa']};
            const cat = t.category && catMap[t.category] ? catMap[t.category] : null;
            return cat ? '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:' + cat[1] + '22;color:' + cat[1] + ';font-weight:600">' + cat[0] + '</span>' : '';
          })()}
          ${isOverdue?'<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(239,68,68,.15);color:var(--red);font-weight:700">⚠️ گذشته</span>':''}
          ${(()=>{
            if (!t.goal_id) return '';
            const g = (_db.goals||[]).find(x=>x.id===t.goal_id);
            return g ? '<span style="font-size:9px;padding:1px 7px;border-radius:4px;background:rgba(124,106,247,.13);color:var(--accent2);font-weight:600">' + (g.icon||'🎯') + ' ' + escapeHtml(g.title) + '</span>' : '';
          })()}
          ${t.remind_min>0&&!t.done?'<span style="font-size:10px;color:var(--amber)">🔔</span>':''}
          ${_todoAssigneeLabel(t)?`<span style="font-size:9px;padding:1px 7px;border-radius:4px;background:rgba(96,165,250,.12);color:#60a5fa;font-weight:700">👤 ${escapeHtml(_todoAssigneeLabel(t))}</span>`:''}
          ${(typeof _isTeamGuest === 'function' && _isTeamGuest() && _todoEmployerLabel())?`<span style="font-size:9px;padding:1px 7px;border-radius:4px;background:rgba(167,139,250,.14);color:#a78bfa;font-weight:700">🏢 ${escapeHtml(_todoEmployerLabel())}</span>`:''}
          ${t.requires_report && t.requires_report !== 'none'?`<span style="font-size:9px;padding:1px 7px;border-radius:4px;background:rgba(62,207,142,.10);color:var(--green);font-weight:700">گزارش ${t.requires_report==='required'?'الزامی':'اختیاری'}</span>`:''}
        </div>
        ${t.note?`<div style="font-size:11px;color:var(--text3);line-height:1.4">${escapeHtml(t.note.slice(0,60))}${t.note.length>60?'…':''}</div>`:''}
        <div style="font-size:11px;margin-top:5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${_todoDateBadge(t, todayKey, tomorrowKey, isOverdue)}
        </div>
      </div>
      <div class="row-menu" onclick="event.stopPropagation()">
        <button class="row-menu-btn todo-overdue-menu-btn" onclick="toggleRowMenu(event,'${todoMenuId}')" aria-label="عملیات کار">⋮</button>
        <div class="row-menu-panel" id="${todoMenuId}">
          <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'move_tomorrow')">↪ ببر به فردا</div>
          <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'move_today')">↩ ببر به امروز</div>
          <div class="row-menu-item" onclick="_resolveTodoMenuAction(${t.id},'skip')">⏭ رد کردن این نوبت</div>
          <div class="row-menu-item" style="color:var(--red)" onclick="_resolveTodoMenuAction(${t.id},'delete')">🗑 حذف</div>
        </div>
      </div>
    </div>`;
  };

  const sectionHeader = (icon, title, subtitle, color='var(--text)') => `
    <div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px">
      <h3 style="font-size:14px;font-weight:700;color:${color};margin:0;display:flex;align-items:center;gap:6px">
        ${icon} ${title}
      </h3>
      ${subtitle?`<span style="font-size:11px;color:var(--text3)">${subtitle}</span>`:''}
    </div>`;

  let html = _todoTabsHtml() + _todoStickyAddBoxHtml({
    activeCount,
    todayCount: todayTodos.length,
    overdueCount: overdueTodos.length,
    doneCnt,
    totalToday: todayTodos.length,
    progress,
    completedTodayTotal,
    lateCompletedTodayCount
  });
  html += _todoStaffOverdueNoticeHtml(todayKey);

  // ── عقب‌افتاده ──
  if (overdueTodos.length > 0) {
    html += sectionHeader('🚨', 'عقب‌افتاده', `${fa(overdueTodos.length)} کار از قبل`, 'var(--red)');
    html += `<div style="background:rgba(248,113,113,.06);border:1px solid rgba(248,113,113,.2);border-radius:10px;padding:8px;margin-bottom:8px">`;
    html += _todoRenderedListHtml(overdueTodos, 'overdue', renderTodo);
    html += `</div>`;
  }

  // ── مهم‌ترین کارهای امروز ──
  if (mainTodayTodos.length > 0) {
    html += sectionHeader('⭐', 'مهم‌ترین کارهای امروز', `${fa(mainTodayTodos.length)} از ۳ کار اصلی`, 'var(--amber)');
    html += `<div style="background:rgba(251,191,36,.055);border:1px solid rgba(251,191,36,.22);border-radius:10px;padding:8px;margin-bottom:10px">`;
    html += mainTodayTodos.map(renderTodo).join('');
    html += `</div>`;
  }

  // ── امروز ──
  html += sectionHeader('☀️', 'امروز', `${today} · ${fa(pending)} باقیمانده`, 'var(--text)');
  if (todayTodos.length === 0) {
    html += `<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px;background:var(--bg2);border-radius:10px;margin-bottom:8px">
      🎉 امروز کاری نداری!
    </div>`;
  } else {
    // ناتمام اول — مرتب‌شده بر اساس ساعت (زودتر = بالاتر)، بدون ساعت = آخر
    const regularTodayOpen = todayTodos.filter(t=>!t.done && !mainTodayIds.has(t.id)).sort(_sortByTime);
    html += regularTodayOpen.length ? _todoRenderedListHtml(regularTodayOpen, 'today', renderTodo) : (doneCnt === 0 ? `<div style="text-align:center;padding:14px;color:var(--text3);font-size:12px;background:var(--bg2);border-radius:10px;margin-bottom:8px">کارهای اصلی امروز در بخش بالا هستند.</div>` : '');
    if (doneCnt > 0) {
      html += `<details class="todo-done-details" ${ _todoListShown.doneToday ? 'open' : ''} style="margin-top:10px">
        <summary style="font-size:12px;color:var(--green);cursor:pointer;margin-bottom:8px;
          padding:8px 12px;background:rgba(62,207,142,.06);border:1px solid rgba(62,207,142,.2);
          border-radius:8px;display:flex;align-items:center;gap:6px;list-style:none;user-select:none">
          ✅ <span style="font-weight:600">${fa(doneCnt)} کار انجام‌شده امروز</span>
          <span style="opacity:.5;font-size:10px;margin-right:auto">▾ کلیک برای مشاهده</span>
        </summary>
        <div style="margin-top:6px;opacity:.7">`;
      html += _todoRenderedListHtml(todayTodos.filter(t=>t.done), 'doneToday', renderTodo);
      html += `</div></details>`;
    }
  }

  if (lateDoneTodayTodos.length > 0) {
    html += `<details class="todo-late-done-details" ${ _todoListShown.lateDone ? 'open' : ''} style="margin-top:12px">
      <summary style="list-style:none;cursor:pointer;user-select:none;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border-radius:10px;background:rgba(245,158,11,.07);border:1px solid rgba(245,158,11,.22)">
          <span style="font-size:13px;font-weight:800;color:var(--amber);display:flex;align-items:center;gap:6px">✅ عقب‌افتاده‌های تکمیل‌شده امروز</span>
          <span style="font-size:11px;color:var(--text3)">${fa(lateDoneTodayTodos.length)} نوبت · باز کردن</span>
        </div>
      </summary>
      <div style="background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.16);border-radius:10px;padding:8px;margin-bottom:8px;opacity:.86">
        ${_todoRenderedListHtml(lateDoneTodayTodos, 'lateDone', renderTodo)}
      </div>
    </details>`;
  }

  // ── فردا (کشویی - بسته) ──
  if (tomorrowTodos.length > 0) {
    const _tomorrowSorted = tomorrowTodos.sort(_sortByTime);
    html += `<details ${_todoTomorrowExpanded || _todoListShown.tomorrow ? 'open' : ''} ontoggle="_setTodoTomorrowExpanded(this.open)" style="margin-top:12px">
      <summary style="list-style:none;cursor:pointer;user-select:none;margin-bottom:2px">
        ${sectionHeader('🌙', 'فردا', tomorrowStr + ' · ' + fa(tomorrowTodos.length) + ' کار', 'var(--accent2)')}
      </summary>
      <div style="margin-top:4px">
        ${_todoRenderedListHtml(_tomorrowSorted, 'tomorrow', renderTodo)}
      </div>
    </details>`;
  }

  // ── محاسبه کلیدهای هفته / ماه / فصل / سال ──
  const _getWeekMonthSeasonYear = () => {
    const [jy, jm, jd] = _todayJalali();
    // آخر هفته جاری = شنبه آینده (در تقویم شمسی هفته شنبه تا جمعه است)
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    const dow = new Date(gy, gm-1, gd).getDay(); // 0=Sun..6=Sat
    // شنبه = 6 در JS → روزهای تا شنبه بعدی
    const daysToSat = dow === 6 ? 7 : (6 - dow + 7) % 7 || 7;
    const endOfWeekArr = _addDays(jy, jm, jd, daysToSat);
    const endOfWeekKey = _jalaliKey(_formatJalali(...endOfWeekArr));
    // آخر ماه جاری
    const daysInMonth = jm <= 6 ? 31 : jm <= 11 ? 30 : 29;
    const endOfMonthKey = _jalaliKey(_formatJalali(jy, jm, daysInMonth));
    // آخر فصل جاری (فصل‌های شمسی: ۱-۳ بهار، ۴-۶ تابستان، ۷-۹ پاییز، ۱۰-۱۲ زمستان)
    const endSeasonMonth = jm <= 3 ? 3 : jm <= 6 ? 6 : jm <= 9 ? 9 : 12;
    const endSeasonDays = endSeasonMonth <= 6 ? 31 : 30;
    const endOfSeasonKey = _jalaliKey(_formatJalali(jy, endSeasonMonth, endSeasonDays));
    // آخر سال
    const endOfYearKey = _jalaliKey(_formatJalali(jy, 12, 29));
    return { endOfWeekKey, endOfMonthKey, endOfSeasonKey, endOfYearKey, jy };
  };
  const { endOfWeekKey, endOfMonthKey, endOfSeasonKey, endOfYearKey, jy: _jy } = _getWeekMonthSeasonYear();

  // ── دسته‌بندی آینده ──
  if (futureTodos.length > 0) {
    const _renderCollapsible = (key, icon, title, subtitle, color, items) => {
      if (!items.length) return '';
      const itemsHTML = _todoRenderedListHtml(items.sort(_sortByTime), 'future-' + key, renderTodo);
      const isOpen = !!_todoFutureExpanded[key];
      return '<details ' + (isOpen ? 'open ' : '') + 'ontoggle="_setTodoFutureExpanded(\'' + key + '\', this.open)" style="margin-top:10px">' +
        '<summary style="list-style:none;cursor:pointer;user-select:none;margin-bottom:2px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0 6px">' +
            '<h3 style="font-size:14px;font-weight:700;color:' + color + ';margin:0;display:flex;align-items:center;gap:6px">' +
              icon + ' ' + title +
            '</h3>' +
            '<span style="font-size:11px;color:var(--text3)">' + subtitle + '</span>' +
          '</div>' +
        '</summary>' +
        '<div style="margin-top:4px">' + itemsHTML + '</div>' +
        '</details>';
    };

    // مرز اول: بزرگتر از tomorrowKey
    const _afterTomorrow = Math.max(tomorrowKey, 0);
    // «این هفته» = از پس‌فردا تا آخر هفته (یا اگه endOfWeekKey < tomorrowKey، خالیه)
    const _weekEnd   = Math.max(endOfWeekKey, _afterTomorrow);
    const _monthEnd  = Math.max(endOfMonthKey, _weekEnd);
    const _seasonEnd = Math.max(endOfSeasonKey, _monthEnd);
    const _yearEnd   = Math.max(endOfYearKey, _seasonEnd);

    const _thisWeek   = futureTodos.filter(t => { const k = _jalaliKey(t.date_jalali); return k > _afterTomorrow && k <= endOfWeekKey; });
    const _thisMonth  = futureTodos.filter(t => { const k = _jalaliKey(t.date_jalali); return k > endOfWeekKey && k <= endOfMonthKey; });
    const _thisSeason = futureTodos.filter(t => { const k = _jalaliKey(t.date_jalali); return k > endOfMonthKey && k <= endOfSeasonKey; });
    const _thisYear   = futureTodos.filter(t => { const k = _jalaliKey(t.date_jalali); return k > endOfSeasonKey && k <= endOfYearKey; });
    const _beyond     = futureTodos.filter(t => _jalaliKey(t.date_jalali) > endOfYearKey);

    html += _renderCollapsible('week', '📅', 'این هفته', fa(_thisWeek.length) + ' کار', '#a78bfa', _thisWeek);
    html += _renderCollapsible('month', '🗓', 'این ماه', fa(_thisMonth.length) + ' کار', '#60a5fa', _thisMonth);
    html += _renderCollapsible('season', '🍂', 'این فصل', fa(_thisSeason.length) + ' کار', '#34d399', _thisSeason);
    html += _renderCollapsible('year', '📆', 'امسال', fa(_thisYear.length) + ' کار', '#fbbf24', _thisYear);
    if (_beyond.length > 0) {
      html += _renderCollapsible('beyond', '🔮', 'سال‌های بعد', fa(_beyond.length) + ' کار', '#9399ab', _beyond);
    }
  }

  // ── بدون تاریخ (اگه موجود) ──
  const noDateTodos = todos.filter(t => !t.date_jalali && !t.done && !t.archived);
  if (noDateTodos.length > 0 && todayTodos.length === 0) {
    // اگه بدون تاریخ هستن و امروز نیستن (نباید پیش بیاد ولی safety)
  }

  const paging = _todoPagingState(false);
  if (!paging.done) {
    html += '<button type="button" class="todo-show-more" onclick="_loadMoreTodos(false)">دریافت کارهای بیشتر از سرور</button>';
  }
  setContent(`${_todoCalendarResponsiveCss()}<div class="todo-calendar-shell">${html}</div>`);
  if (!skipMaintenance) _checkTodoReminders();
  _initTodoDragDrop();
}


function _initTodoDragDrop() {
  let dragId = null, dragEl = null;

  document.querySelectorAll('[data-todo-id]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragId = +el.dataset.todoId;
      dragEl = el;
      el.style.opacity = '.3';
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragend', () => {
      el.style.opacity = '';
      document.querySelectorAll('.todo-drop-indicator').forEach(d => d.remove());
      dragEl = null; dragId = null;
    });

    el.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || el === dragEl) return;
      e.dataTransfer.dropEffect = 'move';
      // نشانگر جایگاه
      document.querySelectorAll('.todo-drop-indicator').forEach(d => d.remove());
      const indicator = document.createElement('div');
      indicator.className = 'todo-drop-indicator';
      indicator.style.cssText = 'height:2px;background:var(--accent);border-radius:2px;margin:2px 0;transition:none';
      el.parentNode.insertBefore(indicator, el);
    });

    el.addEventListener('drop', e => {
      e.preventDefault();
      if (!dragId || +el.dataset.todoId === dragId) return;
      const targetId = +el.dataset.todoId;

      // جابجایی در _db.todos
      const todos = _db.todos;
      const fromIdx = todos.findIndex(t => t.id === dragId);
      const toIdx   = todos.findIndex(t => t.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return;

      const [moved] = todos.splice(fromIdx, 1);
      const newToIdx = todos.findIndex(t => t.id === targetId);
      todos.splice(newToIdx, 0, moved);

      _save(false);
      renderTodoList();
    });
  });
}


function _quickAddTodo(title) {
  _todosInit();
  const id = _allocateTodoId();
  const today = _todayJalaliStr();
  const todo = {
    id, title, note:'', date_jalali: today, time:'',
    repeat:'none', weekdays:'', remind_min:0,
    done:false, done_at:null, archived:false,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), status:'pending',
  };
  _db.todos.push(todo);
  _save(true, { scheduleServerSync: false });
  void _syncTodoDelta(todo, 'create');
  showToast('✓ ' + title, 'success');
  renderTodoList();
}

// ── Toggle done ───────────────────────────────────────────────────────────────

function _todoCompletionRequiresForm(t) {
  return !t.done && (
    t.requires_report === 'required' || t.requires_report === 'optional' ||
    t.requires_attachment === 'required' || t.requires_attachment === 'optional'
  );
}

function _todoCompletePointerDown(event, id) {
  if (event?.button != null && event.button !== 0) return;
  const t = _db?.todos?.find(x => x.id == id);
  // A report/attachment opens the existing form; never make it look completed.
  if (!t || _todoCompletionRequiresForm(t)) return;
  event.currentTarget?.classList.add('todo-tick-press');
  try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch (e) {}
}

function _todoCompletePointerCancel(event) {
  event.currentTarget?.classList.remove('todo-tick-press');
}

function _todoCompletePointerUp(event, id) {
  if (event?.button != null && event.button !== 0) return;
  const button = event.currentTarget;
  button?.classList.remove('todo-tick-press');
  try { button?.releasePointerCapture?.(event.pointerId); } catch (e) {}
  if (!button) return;
  // Keep the synthesized click from running the same toggle a second time.
  button.dataset.todoPointerHandledAt = String(Date.now());
  event.preventDefault();
  _completeTodoFromList(id);
}

function _todoCompleteClick(event, id) {
  const handledAt = Number(event?.currentTarget?.dataset?.todoPointerHandledAt || 0);
  if (handledAt && Date.now() - handledAt < 750) {
    event.preventDefault();
    event.stopPropagation();
    return false;
  }
  // Retain keyboard activation while touch/pointer completion happens on pointerup.
  _completeTodoFromList(id);
  return false;
}

function _completeTodoFromList(id) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  const scheduled = _todoScheduledDate(t);
  const needsCompletionForm = _todoCompletionRequiresForm(t);
  if (!needsCompletionForm && !t.done && scheduled && _jalaliKey(scheduled) < _jalaliToday()) {
    _resolveOverdueTodo(id, 'done');
    return;
  }
  _toggleTodo(id);
}


function _toggleTodo(id) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  if (!_todoCanComplete(t)) { showToast('برای تیک‌زدن این کار دسترسی نداری', 'error'); return; }
  if (_todoCompletionRequiresForm(t)) {
    _openTodoCompletionReport(id);
    return;
  }
  _completeTodoWithReport(t, '');
}


function _openTodoCompletionReport(id) {
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  openModal('ثبت نتیجه کار', `
    <div style="font-size:13px;color:var(--text2);line-height:1.8;margin-bottom:10px">${escapeHtml(t.title || '')}</div>
    <label class="form-label">گزارش انجام کار ${t.requires_report === 'required' ? '*' : ''}</label>
    <textarea class="form-input" id="todo-completion-report" rows="4" placeholder="نتیجه انجام کار را بنویس...">${escapeHtml(t.staff_report || '')}</textarea>
    <label class="form-label" style="margin-top:10px">فایل یا تصویر</label>
    <input class="form-input" id="todo-completion-file" type="file" ${t.requires_attachment === 'required' ? 'required' : ''}>
  `, [
    {label:'ثبت و تکمیل', cls:'btn-primary', action:`_submitTodoCompletionReport(${id})`},
    {label:'انصراف', cls:'btn-ghost', action:'closeModal()'},
  ]);
}


function _submitTodoCompletionReport(id) {
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  const report = document.getElementById('todo-completion-report')?.value.trim() || '';
  const fileInput = document.getElementById('todo-completion-file');
  if (t.requires_report === 'required' && !report) { showToast('ثبت گزارش برای این کار الزامی است', 'error'); return; }
  if (t.requires_attachment === 'required' && !fileInput?.files?.length) { showToast('افزودن فایل یا تصویر برای این کار الزامی است', 'error'); return; }
  if (fileInput?.files?.length) {
    t.report_attachment_name = fileInput.files[0].name;
    t.report_attachment_at = new Date().toISOString();
  }
  closeModal();
  _completeTodoWithReport(t, report);
}


function _todoAddHistory(t, action, oldValue, newValue) {
  _db.todo_history = _db.todo_history || [];
  const row = { task_id:t.id, user_id:_sbUser?.id || _teamEmail() || 'local', action, old_value:oldValue, new_value:newValue, created_at:new Date().toISOString() };
  _db.todo_history.push(row);
  t.history = Array.isArray(t.history) ? t.history : [];
  t.history.push(row);
}


function _completeTodoWithReport(t, report) {
  const scheduledDate = _todoScheduledDate(t);
  const scheduledKey = scheduledDate ? _jalaliKey(scheduledDate) : 0;
  const todayKey = _jalaliToday();
  const oldDone = !!t.done;
  const intendedOp = oldDone ? 'reopen' : 'complete';
  let extraTodos = [];
  t.done = !t.done;
  t.done_at = t.done ? new Date().toISOString() : null;
  t.completedAt = t.done_at;
  t.completed_at = t.done_at;
  t.completed_by = t.done ? (_sbUser?.id || _teamEmail() || 'local') : '';
  t.completed_by_email = t.done ? _teamEmail() : '';
  if (report) {
    t.staff_report = report;
    t.report_updated_at = new Date().toISOString();
  }
  t.status = t.done
    ? (t.requires_approval ? 'pending_approval' : (scheduledKey && scheduledKey < todayKey ? 'late_completed' : 'completed'))
    : 'pending';
  if (oldDone && !t.done) {
    t.archived = false;
    t._snapshot = false;
    if (t._occurrence) t.repeat = 'none';
    t.completedAt = null;
    t.completed_at = null;
    t.skipped_at = null;
  }
  t.updated_at = new Date().toISOString();
  _todoAddHistory(t, t.done ? 'completed' : 'unchecked', oldDone, t.done);

  if (t.done) {
    if (t.repeat && t.repeat !== 'none') {
      const completedAt = t.done_at || new Date().toISOString();
      extraTodos.push(_createTodoOccurrenceRecord(t, t.status, completedAt));
      _advanceRecurringTodoOccurrence(t, scheduledDate);
      if (scheduledKey && scheduledKey < todayKey) {
        showToast(`نوبت ${DateService.disp(scheduledDate)} تکمیل شد.`, 'success');
      }
    }
    // کارهای غیر تکراری: در renderTodoList روز بعد archive میشن
  }
  // ابتدا نتیجه کلیک را فوراً نشان بده. ذخیره localStorage نباید پشت setTimeout
  // بماند؛ در اندروید با رفتن برنامه به پس‌زمینه آن تایمر اجرا نمی‌شود و تیک برمی‌گردد.
  const stillOpenToday = !t.done && _todoRemainsOpenToday(t);
  if (intendedOp === 'complete' && !stillOpenToday && _paintTodoCheckedFast(t.id)) {
    _queueTodoTickPersist(t, intendedOp, extraTodos);
    return;
  }
  renderTodoList();
  if (t.done) {
    const details = document.querySelector('.todo-done-details');
    if (details) details.open = true;
  }
  try {
    _save(true, { scheduleServerSync: false, quiet: true });
    void _syncTodoDelta(t, intendedOp, extraTodos);
  } catch(e) {
    console.error('[TeamPulse] todo persist failed:', e);
  }
}


function _resolveOverdueTodo(id, action) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  const scheduledDate = _todoScheduledDate(t);
  const today = _todayJalaliStr();
  const scheduledKey = scheduledDate ? _jalaliKey(scheduledDate) : 0;
  const todayKey = _jalaliKey(today);
  if (!scheduledDate || scheduledKey >= todayKey) return;

  if (action === 'done') {
    if (!_todoCanComplete(t)) { showToast('برای تیک‌زدن این کار دسترسی نداری', 'error'); return; }
    if (_isTodoRecurring(t)) {
      const completedAt = new Date().toISOString();
      const snapshot = _createTodoOccurrenceRecord(t, 'late_completed', completedAt);
      _advanceRecurringTodoOccurrence(t, scheduledDate);
      _todoAddHistory(t, 'completed', false, true);
      t.updated_at = completedAt;
      showToast(`نوبت ${DateService.disp(scheduledDate)} تکمیل شد.`, 'success');
      if (!_todoRemainsOpenToday(t) && _paintTodoCheckedFast(t.id)) {
        _queueTodoTickPersist(t, 'complete', [snapshot]);
        return;
      }
      renderTodoList();
      _queueTodoTickPersist(t, 'complete', [snapshot]);
      return;
    }
    t.done = true;
    t.done_at = new Date().toISOString();
    t.completedAt = t.done_at;
    t.completed_at = t.done_at;
    t.status = 'late_completed';
    t.updated_at = t.done_at;
    _todoAddHistory(t, 'completed', false, true);
    if (!_paintTodoCheckedFast(t.id)) renderTodoList();
    _queueTodoTickPersist(t, 'complete');
    return;
  }

  if (action === 'skip') {
    if (_isTodoRecurring(t)) {
      _createTodoOccurrenceRecord(t, 'skipped', new Date().toISOString());
      _advanceRecurringTodoOccurrence(t, scheduledDate);
    } else {
      t.status = 'skipped';
      t.skipped_at = new Date().toISOString();
      t.archived = true;
      t.done = false;
      t.done_at = null;
      t.updated_at = t.skipped_at;
    }
    _save();
    showToast(`نوبت ${DateService.disp(scheduledDate)} رد شد؛ برنامه امروز بدون تغییر ادامه دارد.`, 'warning');
    renderTodoList();
    return;
  }

  if (action === 'delete_occurrence') {
    if (!confirm('فقط همین نوبت حذف شود؟ قالب تکرار و نوبت امروز دست‌نخورده می‌ماند.')) return;
    _deleteTodoOccurrenceOnly(t, scheduledDate);
    _save();
    showToast('نوبت حذف شد؛ زنجیره تکرار حفظ شد.', 'success');
    renderTodoList();
    return;
  }

  if (action === 'move_today') {
    _moveTodoOccurrenceToToday(t, scheduledDate, today);
    return;
  }
}


function _resolveTodoMenuAction(id, action) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  const scheduledDate = _todoScheduledDate(t);
  const today = _todayJalaliStr();
  const scheduledKey = scheduledDate ? _jalaliKey(scheduledDate) : 0;
  const todayKey = _jalaliKey(today);

  if (scheduledDate && scheduledKey < todayKey && ['done','skip','move_today','delete_occurrence'].includes(action)) {
    _resolveOverdueTodo(id, action);
    return;
  }

  if (action === 'done') {
    _toggleTodo(id);
    return;
  }

  if (action === 'move_today') {
    if (!_todoCanEdit(t)) { showToast('برای جابه‌جایی این کار دسترسی نداری', 'error'); return; }
    if (scheduledDate && scheduledKey === todayKey) { showToast('این کار همین امروز است', 'info'); return; }
    _moveTodoOccurrenceToToday(t, scheduledDate || today, today);
    return;
  }

  if (action === 'move_tomorrow') {
    if (!_todoCanEdit(t)) { showToast('برای جابه‌جایی این کار دسترسی نداری', 'error'); return; }
    const tomorrow = _tomorrowJalaliStr();
    if (scheduledDate && _jalaliKey(scheduledDate) === _jalaliKey(tomorrow)) { showToast('این کار همین فرداست', 'info'); return; }
    _moveTodoOccurrenceToDate(t, scheduledDate || today, tomorrow, 'فردا');
    return;
  }

  if (action === 'skip') {
    if (!_todoCanComplete(t) && !_todoCanEdit(t)) { showToast('برای تعیین تکلیف این کار دسترسی نداری', 'error'); return; }
    if (_isTodoRecurring(t)) {
      _createTodoOccurrenceRecord(t, 'skipped', new Date().toISOString());
      _advanceRecurringTodoOccurrence(t, scheduledDate || today);
    } else {
      t.status = 'skipped';
      t.skipped_at = new Date().toISOString();
      t.archived = true;
      t.done = false;
      t.done_at = null;
      t.updated_at = t.skipped_at;
    }
    _save(); _syncToServer();
    showToast('این نوبت رد شد و در گزارش انجام‌نشده‌ها می‌ماند', 'warning');
    renderTodoList();
    return;
  }

  if (action === 'delete') {
    _deleteTodoCompletely(id);
  }
}


function _deleteTodoOccurrenceOnly(t, scheduledDate = _todoScheduledDate(t)) {
  if (!t) return;
  if (_isTodoRecurring(t)) {
    _advanceRecurringTodoOccurrence(t, scheduledDate);
  } else {
    _db.todos = _db.todos.filter(x => x.id != t.id);
  }
}


function _moveTodoOccurrenceToDate(t, scheduledDate, targetDate, targetLabel) {
  const rootId = _todoRootId(t);
  const existingTarget = _todoHasOccurrenceFor(rootId, targetDate, t.id);
  if (existingTarget) {
    const makeBoth = confirm(`از همین کار یک نوبت برای ${targetLabel} وجود دارد. تایید = هر دو نوبت ${targetLabel} انجام شوند. انصراف = نوبت قبلی رد شود و فقط نوبت ${targetLabel} باقی بماند.`);
    if (!makeBoth) {
      if (_isTodoRecurring(t)) _createTodoOccurrenceRecord(t, 'skipped', new Date().toISOString());
      _db.todos = _db.todos.filter(x => x.id != t.id);
      _save(); _syncToServer();
      showToast(`نوبت ${DateService.disp(scheduledDate)} انجام‌نشده بسته شد؛ برنامه ${targetLabel} بدون تغییر ادامه دارد.`, 'warning');
      renderTodoList();
      return;
    }
    const copy = {
      ...t,
      id: _allocateTodoId(),
      recurrence_parent_id: rootId,
      scheduled_date: targetDate,
      scheduledDate: targetDate,
      date_jalali: targetDate,
      repeat: 'none',
      done: false,
      done_at: null,
      completedAt: null,
      completed_at: null,
      status: 'pending',
      archived: false,
      _occurrence: true,
      _moved_from: scheduledDate,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    _db.todos.push(copy);
    _db.todos = _db.todos.filter(x => x.id != t.id);
  } else {
    t.date_jalali = targetDate;
    t.scheduled_date = targetDate;
    t.scheduledDate = targetDate;
    t.status = 'pending';
    t.done = false;
    t.done_at = null;
    t.completedAt = null;
    t.completed_at = null;
    t.updated_at = new Date().toISOString();
  }
  _save(); _syncToServer();
  showToast(`نوبت ${DateService.disp(scheduledDate)} به ${targetLabel} منتقل شد.`, 'success');
  renderTodoList();
}


function _moveTodoOccurrenceToToday(t, scheduledDate, today) {
  _moveTodoOccurrenceToDate(t, scheduledDate, today, 'امروز');
}


function _currentOverdueTodos() {
  const todayKey = _jalaliToday();
  return (_db.todos || []).filter(t => !t.archived && !t.done && _todoScheduledDate(t) && _jalaliKey(_todoScheduledDate(t)) < todayKey);
}


function _openResolveAllOverdueTodos() {
  _todosInit();
  const count = _currentOverdueTodos().length;
  if (!count) { showToast('نوبت عقب‌افتاده‌ای وجود ندارد.', 'info'); return; }
  openModal('تعیین تکلیف عقب‌افتاده‌ها', `
    <p style="font-size:13px;color:var(--text2);line-height:1.9;margin:0 0 12px">
      ${fa(count)} نوبت عقب‌افتاده پیدا شد. عملیات گروهی فقط روی همین نوبت‌های گذشته انجام می‌شود و برنامه امروز را تغییر نمی‌دهد.
    </p>
    <div style="display:grid;gap:8px">
      <button class="btn btn-success" onclick="_resolveAllOverdueTodos('done')">همه انجام شد</button>
      <button class="btn btn-ghost" style="color:var(--amber)" onclick="_resolveAllOverdueTodos('skip')">همه رد شوند</button>
      <button class="btn btn-danger" onclick="_resolveAllOverdueTodos('delete_occurrence')">حذف همه نوبت‌های گذشته</button>
    </div>
  `, [{label:'انصراف', cls:'btn-ghost', action:'closeModal()'}]);
}


function _resolveAllOverdueTodos(action) {
  const items = _currentOverdueTodos();
  if (!items.length) { closeModal(); return; }
  const labels = { done:'انجام‌شده', skip:'رد کردن', delete_occurrence:'حذف' };
  if (!confirm(`برای ${fa(items.length)} نوبت عقب‌افتاده عملیات «${labels[action] || action}» انجام شود؟`)) return;
  items.slice().forEach(t => {
    const scheduledDate = _todoScheduledDate(t);
    if (action === 'done') {
      if (_isTodoRecurring(t)) {
        _createTodoOccurrenceRecord(t, 'late_completed', new Date().toISOString());
        _advanceRecurringTodoOccurrence(t, scheduledDate);
      } else {
        t.done = true; t.done_at = new Date().toISOString(); t.completedAt = t.done_at; t.completed_at = t.done_at; t.status = 'late_completed'; t.updated_at = t.done_at;
      }
    } else if (action === 'skip') {
      if (_isTodoRecurring(t)) {
        _createTodoOccurrenceRecord(t, 'skipped', new Date().toISOString());
        _advanceRecurringTodoOccurrence(t, scheduledDate);
      } else {
        t.status = 'skipped'; t.skipped_at = new Date().toISOString(); t.archived = true; t.done = false; t.done_at = null; t.updated_at = t.skipped_at;
      }
    } else if (action === 'delete_occurrence') {
      _deleteTodoOccurrenceOnly(t, scheduledDate);
    }
  });
  _save(); closeModal(); renderTodoList();
  showToast('تعیین تکلیف گروهی انجام شد.', 'success');
}


function _todoRemainsOpenToday(t) {
  if (!t || t.done || t.archived || t.status === 'deleted') return false;
  const scheduled = _todoScheduledDate(t);
  if (!scheduled) return true;
  const key = _jalaliKey(scheduled);
  return !!key && key <= _jalaliToday();
}


function openAddTodo(dateStr, presetAssigneeId = '') {
  if (!_todoCanCreateForStaff(presetAssigneeId)) { showToast('برای ساخت این کار دسترسی نداری', 'error'); return; }
  const ownStaff = _todoSessionStaff();
  if (_isTeamGuest() && !ownStaff) {
    showToast(
      'حساب شما به رکورد پرسنلی متصل نشده است. مدیر باید دعوت‌نامه را دوباره ایجاد کند.',
      'error'
    );
    return;
  }
  _requestNotificationPermission();
  const today = _todayJalaliStr();
  const forcedSelfId = _isTeamGuest() && !_teamPerm('todo_create_others') && !_teamPerm('todo_manage_staff') && ownStaff ? String(ownStaff.id) : '';
  const selectedAssigneeId = String(presetAssigneeId || forcedSelfId || '');
  const isStaffTodo = !!selectedAssigneeId;
  const defaultCategory = isStaffTodo ? 'clients' : 'personal';
  const defaultPriority = isStaffTodo ? 'urgent' : 'high';
  const canChooseAssignee = !_isTeamGuest() || _teamPerm('todo_create_others') || _teamPerm('todo_manage_staff');
  const staffRows = (_db.staff || []).filter(s => staffIsPersonnel(s) && (!_isTeamGuest() || canChooseAssignee || String(s.id) === selectedAssigneeId));
  const assigneeOptions = `<option value="" ${selectedAssigneeId ? '' : 'selected'}>کار شخصی من</option>` +
    staffRows.map(s=>`<option value="${s.id}" ${String(s.id)===selectedAssigneeId?'selected':''}>${escapeHtml(_todoStaffName(s))}</option>`).join('');
  const weekDays = [
    {key:'sat', label:'ش'}, {key:'sun', label:'ی'}, {key:'mon', label:'د'},
    {key:'tue', label:'س'}, {key:'wed', label:'چ'}, {key:'thu', label:'پ'}, {key:'fri', label:'ج'}
  ];
  const weekBtns = weekDays.map(d =>
    '<button type="button" id="wd-' + d.key + '" onclick="_toggleWeekDay(this,\'' + d.key + '\')" ' +
    'style="width:34px;height:34px;border-radius:50%;border:1.5px solid var(--border2);background:var(--bg3);' +
    'color:var(--text2);cursor:pointer;font-size:12px;font-weight:600;font-family:var(--font);transition:all .15s">' +
    d.label + '</button>'
  ).join('');

  openModal('✅ کار جدید', `
    <div class="form-group full">
      <label class="form-label">عنوان کار *</label>
      <input class="form-input" id="todo-title" placeholder="مثلاً: تماس با مشتری" autofocus>
    </div>
    <div class="form-group full">
      <label class="form-label">توضیحات</label>
      <textarea class="form-input" id="todo-note" rows="2" placeholder="جزئیات..."></textarea>
    </div>
    <div class="form-group full" style="border:1px solid rgba(251,191,36,.28);border-radius:10px;padding:10px;background:rgba(251,191,36,.045)">
      <label class="form-label">⭐ جایگاه در مهم‌ترین کارهای امروز</label>
      <select class="form-input" id="todo-main-today-rank">
        <option value="0">کار اصلی امروز نیست</option>
        <option value="1">کار اصلی ۱ امروز</option>
        <option value="2">کار اصلی ۲ امروز</option>
        <option value="3">کار اصلی ۳ امروز</option>
      </select>
      <div style="font-size:11px;color:var(--text3);margin-top:5px">اگر تاریخ کار امروز باشد، در بخش «مهم‌ترین کارهای امروز» نمایش داده می‌شود.</div>
    </div>
    <div class="form-group full" style="border:1px solid rgba(96,165,250,.24);border-radius:10px;padding:10px;background:rgba(96,165,250,.035)">
      <label class="form-label">مسئول و دسترسی</label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
        <select class="form-input" id="todo-assignee" ${canChooseAssignee ? '' : 'disabled'}>${assigneeOptions}</select>
        <select class="form-input" id="todo-visibility"><option value="private" ${selectedAssigneeId ? '' : 'selected'}>فقط من</option><option value="assignee" ${selectedAssigneeId ? 'selected' : ''}>فقط مسئول انجام</option><option value="selected">افراد انتخاب‌شده</option><option value="team">اعضای مجاز تیم</option></select>
        <select class="form-input" id="todo-requires-report"><option value="none">گزارش لازم نیست</option><option value="optional">گزارش اختیاری</option><option value="required">گزارش الزامی</option></select>
        <select class="form-input" id="todo-requires-attachment"><option value="none">فایل لازم نیست</option><option value="optional">فایل اختیاری</option><option value="required">فایل الزامی</option></select>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:8px;font-size:12px;color:var(--text2);cursor:pointer"><input type="checkbox" id="todo-requires-approval" style="width:16px;height:16px;accent-color:var(--accent)"> نیاز به تأیید مدیر دارد</label>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;align-items:start">
      <div class="form-group">
        <label class="form-label" style="display:flex;align-items:center;gap:4px">
          📅 تاریخ
          <span style="margin-right:auto;display:flex;gap:4px">
            <button type="button" onclick="_setTodoDateShortcut('today')" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-family:var(--font)">امروز</button>
            <button type="button" onclick="_setTodoDateShortcut('tomorrow')" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-family:var(--font)">فردا</button>
            <button type="button" onclick="_setTodoDateShortcut('nextweek')" style="font-size:10px;padding:2px 6px;border-radius:4px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-family:var(--font)">هفته دیگر</button>
          </span>
        </label>
        <input class="form-input jdate" id="todo-date" value="${dateStr||today}" placeholder="۱۴۰۳/۰۳/۱۵">
      </div>
      <div class="form-group">
        <label class="form-label">⏰ ساعت</label>
        <input class="form-input" id="todo-time" type="time" placeholder="09:00" onchange="_updateTodoEndPreview()" oninput="_updateTodoEndPreview()" style="direction:ltr">
      </div>
      <div class="form-group">
        <label class="form-label">⏱️ مدت انجام</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="form-input" id="todo-duration" type="number" min="5" step="5" value="30" onchange="_updateTodoEndPreview()" oninput="_updateTodoEndPreview()" style="direction:ltr;text-align:center">
          <span style="font-size:11px;color:var(--text3);white-space:nowrap">دقیقه</span>
        </div>
        <div id="todo-end-preview" style="margin-top:5px;font-size:11px;color:var(--accent);font-weight:700;min-height:18px">با انتخاب ساعت، زمان پایان نمایش داده می‌شود</div>
      </div>
    </div>
    <div class="form-group full">
      <label class="form-label">🔁 تکرار</label>
      <select class="form-input" id="todo-repeat" onchange="_onTodoRepeatChange(this.value)">
        <option value="none">بدون تکرار</option>
        <option value="daily">روزانه</option>
        <option value="every2days">یک روز در میان</option>
        <option value="weekly">هفتگی</option>
        <option value="custom_weekdays">روزهای خاص هفته</option>
        <option value="monthly">ماهانه</option>
      </select>
    </div>
    <div id="weekdays-picker" style="display:none;margin-top:4px">
      <label class="form-label" style="margin-bottom:8px">روزهای هفته را انتخاب کن:</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${weekBtns}</div>
      <input type="hidden" id="todo-weekdays" value="">
    </div>
    <div class="form-group full">
      <label class="form-label">🗂 دسته‌بندی</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${_buildCategoryButtons(defaultCategory)}
        <input type="hidden" id="todo-category" value="${defaultCategory}">
      </div>
    </div>
    <div style="margin-bottom:10px">
      <label class="form-label" style="margin-bottom:6px">🚩 اولویت</label>
      <div style="display:flex;gap:6px">
        ${_buildPriorityButtons(defaultPriority)}
        <input type="hidden" id="todo-priority" value="${defaultPriority}">
      </div>
    </div>
    <div class="form-group full">
      <label class="form-label">🎯 مرتبط با هدف (اختیاری)</label>
      <select class="form-input" id="todo-goal">${_buildGoalSelectOptions('')}</select>
    </div>
    <div class="form-group full">
      <label class="form-label">🔔 یادآوری</label>
      <select class="form-input" id="todo-remind">
        <option value="0" selected>بدون یادآوری</option>
        <option value="5">۵ دقیقه قبل</option>
        <option value="10">۱۰ دقیقه قبل</option>
        <option value="15">۱۵ دقیقه قبل</option>
        <option value="30">۳۰ دقیقه قبل</option>
        <option value="60">۱ ساعت قبل</option>
        <option value="120">۲ ساعت قبل</option>
        <option value="1440">۱ روز قبل</option>
      </select>
    </div>
    <div id="notif-status" style="font-size:11px;padding:6px 10px;border-radius:6px;margin-top:4px;
      background:${('Notification' in window && Notification.permission==='granted')?'rgba(62,207,142,.1)':'rgba(251,191,36,.1)'};
      color:${('Notification' in window && Notification.permission==='granted')?'var(--green)':'var(--amber)'}">
      ${('Notification' in window && Notification.permission==='granted')
        ? '🔔 نوتیفیکیشن فعال است — در زمان مقرر یادآوری دریافت می‌کنید'
        : '⚠️ نوتیفیکیشن غیرفعال است — برای فعال‌سازی روی دکمه زیر کلیک کنید'}
      ${!('Notification' in window && Notification.permission==='granted')
        ? '<button onclick="_requestNotifPermission()" style="margin-right:8px;font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid var(--amber);background:transparent;color:var(--amber);cursor:pointer;font-family:var(--font)">فعال‌سازی</button>'
        : ''}
    </div>
    ${_todoGcalCheckboxHtml(false)}
  `, [
    {label: '+ ذخیره', cls: 'btn-primary', action: 'saveTodo()'},
    {label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()'},
  ]);
  setTimeout(() => { initDatePickers(); _updateTodoEndPreview(); _initTodoFormTabs(); }, 50);
}


function _onTodoRepeatChange(val) {
  const el = document.getElementById('weekdays-picker');
  if (el) el.style.display = val === 'custom_weekdays' ? 'block' : 'none';
}


function _toggleWeekDay(btn, day) {
  const active = btn.dataset.active === '1';
  if (active) {
    btn.dataset.active = '0';
    btn.style.background = 'var(--bg3)';
    btn.style.color = 'var(--text2)';
    btn.style.borderColor = 'var(--border2)';
  } else {
    btn.dataset.active = '1';
    btn.style.background = 'var(--accent)';
    btn.style.color = 'white';
    btn.style.borderColor = 'var(--accent)';
  }
  // update hidden input
  const days = ['sat','sun','mon','tue','wed','thu','fri']
    .filter(d => { const b = document.getElementById('wd-' + d); return b && b.dataset.active === '1'; });
  const inp = document.getElementById('todo-weekdays');
  if (inp) inp.value = days.join(',');
}


function _todoGcalCheckboxHtml(checked) {
  return `
    <div class="form-group full" style="margin-top:4px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text2)">
        <input type="checkbox" id="todo-gcal" onchange="_onTodoGcalToggle(this)" ${checked?'checked':''}>
        🗓️ ذخیره در Google Calendar (${escapeHtml(_gcal.calendarName())})
        <span id="todo-gcal-hint" style="display:${_gcal.enabled?'none':'inline'};font-size:11px;color:var(--amber)">(با زدن این تیک یک‌بار به گوگل وصل می‌شوی)</span>
      </label>
    </div>`;
}


async function _onTodoGcalToggle(cb) {
  if (cb.checked && !_gcal.enabled) {
    cb.checked = false;
    cb.disabled = true;
    try {
      await _gcal.connect();
      cb.checked = _gcal.enabled;
    } catch (e) {
      showToast('اتصال ناموفق: ' + e.message, 'error');
    } finally {
      cb.disabled = false;
      const hint = document.getElementById('todo-gcal-hint');
      if (hint) hint.style.display = _gcal.enabled ? 'none' : 'inline';
    }
  }
}


async function saveTodo() {
  if (window._todoSaveInProgress) return;
  window._todoSaveInProgress = true;
  _todosInit();
  const title = document.getElementById('todo-title')?.value.trim();
  if (!title) { window._todoSaveInProgress = false; showToast('عنوان کار را وارد کنید', 'error'); return; }
  const repeat = document.getElementById('todo-repeat')?.value || 'none';
  const weekdays = repeat === 'custom_weekdays'
    ? (document.getElementById('todo-weekdays')?.value || '')
    : '';
  const remindMin = parseInt(document.getElementById('todo-remind')?.value || '0');
  const dateJalali = document.getElementById('todo-date')?.value.trim() || _todayJalaliStr();
  const time = document.getElementById('todo-time')?.value || '';
  const durationMin = time ? (_todoDurationMinutes(document.getElementById('todo-duration')?.value || '30') || 30) : 0;
  if (remindMin > 0 && !time) {
    window._todoSaveInProgress = false;
    showToast('برای ارسال نوتیفیکیشن، ساعت کار را مشخص کن', 'error');
    return;
  }
  if (remindMin > 0 && !(await _ensureReminderPushEnabled('notif-status'))) {
    window._todoSaveInProgress = false;
    return;
  }

  const priority = document.getElementById('todo-priority')?.value || 'medium';
  const category = document.getElementById('todo-category')?.value || 'general';
  const goalId = document.getElementById('todo-goal')?.value || '';
  const mainTodayRank = Math.max(0, Math.min(3, parseInt(document.getElementById('todo-main-today-rank')?.value || '0', 10) || 0));
  const syncGcal = !!document.getElementById('todo-gcal')?.checked;
  const assigneeEl = document.getElementById('todo-assignee');
  const ownStaff = _todoSessionStaff();

  if (_isTeamGuest() && _teamPerm('todo_create_self') && !ownStaff) {
    window._todoSaveInProgress = false;
    showToast('حساب پرسنلی شما شناسایی نشد', 'error');
    return;
  }

  let assigneeId = assigneeEl?.value || (assigneeEl?.disabled && ownStaff ? String(ownStaff.id) : '');

  if (_isTeamGuest() && ownStaff && !_teamPerm('todo_create_others')) {
    assigneeId = String(ownStaff.id);
  }

  if (!_todoCanCreateForStaff(assigneeId)) { window._todoSaveInProgress = false; showToast('برای ساخت این چک‌لیست دسترسی نداری', 'error'); return; }
  const assignee = (_db.staff || []).find(s => staffIsPersonnel(s) && String(s.id) === String(assigneeId));
  const visibility = document.getElementById('todo-visibility')?.value || (assignee ? 'assignee' : 'private');
  const id = _allocateTodoId();
  const newTodo = {
    id, title,
    note: document.getElementById('todo-note')?.value.trim() || '',
    manager_note: document.getElementById('todo-note')?.value.trim() || '',
    assignee_id: assignee?.id || ownStaff?.id || null,
    assignee_email:
      assignee?.email ||
      ownStaff?.email ||
      (_isTeamGuest() ? _teamEmail() : '') ||
      '',
    visibility,
    shared_with: [],
    requires_report: document.getElementById('todo-requires-report')?.value || 'none',
    requires_attachment: document.getElementById('todo-requires-attachment')?.value || 'none',
    requires_approval: !!document.getElementById('todo-requires-approval')?.checked,
    owner_id: _todoActiveOwnerId() || 'local-owner',
    created_by: _sbUser?.id || 'local-owner',
    created_by_name: _sbUser?.name || '',
    date_jalali: dateJalali,
    scheduled_date: dateJalali,
    scheduledDate: dateJalali,
    time,
    duration_min: durationMin,
    repeat,
    weekdays,
    priority,
    category,
    main_today_rank: _jalaliKey(dateJalali) === _jalaliToday() ? mainTodayRank : 0,
    goal_id: goalId ? +goalId : null,
    remind_min: remindMin,
    sync_gcal: syncGcal,
    gcal_event_id: null,
    gcal_calendar_id: syncGcal ? _gcal.calendarId() : null,
    done: false, done_at: null, completedAt: null, completed_at: null, archived: false, status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  let relatedRankChanged = false;
  if (newTodo.main_today_rank > 0) {
    (_db.todos || []).forEach(t => {
      if (!t.archived && !t.done && _jalaliKey(t.date_jalali || t.scheduled_date || t.scheduledDate || '') === _jalaliToday() && +t.main_today_rank === newTodo.main_today_rank) {
        t.main_today_rank = 0;
        t.updated_at = new Date().toISOString();
        relatedRankChanged = true;
      }
    });
  }
  if (_isTeamGuest() && !newTodo.assignee_id && !newTodo.assignee_email) {
    window._todoSaveInProgress = false;
    showToast('کار بدون مسئول ذخیره نمی‌شود', 'error');
    return;
  }

  _db.todos.push(newTodo);

  // Schedule notification
  if (remindMin > 0 && time && dateJalali) {
    _scheduleTodoNotification(id, title, dateJalali, time, remindMin);
  }

  // Sync to Google Calendar if requested
  if (syncGcal && dateJalali) {
    _gcal.upsertEvent(newTodo);
  }

  closeModal();
  showToast('کار روی دستگاه ذخیره شد ✓', 'success');
  renderTodoList();
  // Let iOS/Android paint the optimistic UI before serializing the large local
  // database. The Todo is already in _db; persistence and upload follow next.
  await new Promise(resolve => requestAnimationFrame(() => resolve()));
  _save(true, { scheduleServerSync: false });
  window._todoSaveInProgress = false;

  const syncPromise = relatedRankChanged ? _syncToServer() : _syncTodoDelta(newTodo, 'create');
  void syncPromise.then(async syncRes => {
    if (syncRes && syncRes.status === 403 && _teamAccessSession()) {
      // A definitive permission rejection must be rolled back. Transient
      // network/server failures stay local and are retried automatically.
      _db.todos = _db.todos.filter(t => t.id !== id);
      _save();
      showToast('ذخیره کار رد شد؛ دسترسی هم‌تیمی را بررسی کن', 'error');
      await _loadFromServer();
      renderTodoList();
    }
  });
}


function _openTodoReadonly(id) {
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  openModal('جزئیات کار', `
    <div style="display:grid;gap:10px;font-size:13px;color:var(--text2);line-height:1.9">
      <div><b style="color:var(--text)">عنوان:</b> ${escapeHtml(t.title || '')}</div>
      ${t.manager_note || t.note ? `<details open style="border:1px solid var(--border);border-radius:10px;padding:9px;background:var(--bg2)"><summary style="cursor:pointer;font-weight:800;color:var(--text)">توضیحات مدیر</summary><div style="margin-top:7px">${escapeHtml(t.manager_note || t.note || '')}</div></details>` : ''}
      <div><b style="color:var(--text)">مسئول:</b> ${escapeHtml(_todoAssigneeLabel(t) || '—')}</div>
      ${(typeof _isTeamGuest === 'function' && _isTeamGuest() && _todoEmployerLabel()) ? `<div><b style="color:var(--text)">کارفرما:</b> 🏢 ${escapeHtml(_todoEmployerLabel())}</div>` : ''}
      <div><b style="color:var(--text)">تاریخ:</b> ${DateService.disp(_todoScheduledDate(t) || '')} ${t.time ? ' · ' + escapeHtml(_todoTimeRangeLabel(t)) : ''}</div>
      <div><b style="color:var(--text)">وضعیت:</b> ${escapeHtml(t.status || (t.done ? 'completed' : 'pending'))}</div>
      ${t.staff_report ? `<details open style="border:1px solid rgba(62,207,142,.24);border-radius:10px;padding:9px;background:rgba(62,207,142,.05)"><summary style="cursor:pointer;font-weight:800;color:var(--green)">گزارش انجام کار</summary><div style="margin-top:7px">${escapeHtml(t.staff_report)}</div></details>` : ''}
    </div>
  `, [{label:'بستن', cls:'btn-ghost', action:'closeModal()'}]);
}


function openEditTodo(id) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  if (!_todoCanEdit(t)) { _openTodoReadonly(id); return; }
  _requestNotificationPermission();

  const weekDays = [
    {key:'sat', label:'ش'}, {key:'sun', label:'ی'}, {key:'mon', label:'د'},
    {key:'tue', label:'س'}, {key:'wed', label:'چ'}, {key:'thu', label:'پ'}, {key:'fri', label:'ج'}
  ];
  const savedWeekdays = (t.weekdays || '').split(',').filter(Boolean);
  const weekBtns = weekDays.map(d => {
    const active = savedWeekdays.includes(d.key);
    return '<button type="button" id="wd-' + d.key + '" data-active="' + (active?'1':'0') + '" onclick="_toggleWeekDay(this,\'' + d.key + '\')" ' +
      'style="width:34px;height:34px;border-radius:50%;border:1.5px solid var(--border2);' +
      'background:' + (active?'var(--accent)':'var(--bg3)') + ';' +
      'color:' + (active?'white':'var(--text2)') + ';' +
      'cursor:pointer;font-size:12px;font-weight:600;font-family:var(--font)">' + d.label + '</button>';
  }).join('');

  const repeatVal = t.repeat || 'none';
  const editCategoryLabels = {clients:'مشتریان', routine:'روتین‌ها', general:'عمومی', personal:'شخصی'};
  const editPriorityLabels = {low:'پایین', medium:'متوسط', high:'بالا', urgent:'فوری'};
  const editAssignee = (_db.staff || []).find(s => String(s.id) === String(t.assignee_id || ''));
  const editAssigneeLabel = editAssignee ? _todoStaffName(editAssignee) : 'کار شخصی';
  const editGoal = (_db.goals || []).find(g => String(g.id) === String(t.goal_id || ''));
  const editGoalLabel = editGoal ? (editGoal.icon || '🎯') + ' ' + editGoal.title : 'بدون هدف';
  const editNotePreview = t.note ? escapeHtml(String(t.note).replace(/\s+/g, ' ').slice(0, 110)) : 'افزودن توضیحات...';
  const editReportLabels = {none:'گزارش لازم نیست', optional:'گزارش اختیاری', required:'گزارش الزامی'};
  const editAttachLabels = {none:'بدون فایل', optional:'فایل اختیاری', required:'فایل الزامی'};
  const editExtraSummary = [
    editReportLabels[t.requires_report || 'none'] || 'گزارش لازم نیست',
    t.requires_approval ? 'تأیید مدیر فعال' : 'بدون تأیید مدیر',
    editAttachLabels[t.requires_attachment || 'none'] || 'بدون فایل'
  ].join(' • ');

  openModal('✏️ ویرایش کار', `
    <div class="todo-edit-form">
      <section class="todo-edit-section">
        <div class="todo-edit-section-title"><span>اطلاعات اصلی</span><small>چه کاری؟ چه کسی؟</small></div>
        <div class="form-group full">
          <label class="form-label">عنوان کار *</label>
          <input class="form-input" id="todo-title" value="${escapeHtml(t.title)}" autofocus>
        </div>
        <details class="todo-note-disclosure">
          <summary>
            <span>جزئیات</span>
            <span class="todo-note-preview">${editNotePreview}</span>
            <span class="todo-acc-chevron">⌄</span>
          </summary>
          <div class="todo-note-body">
            <textarea class="form-input" id="todo-note" rows="2" placeholder="جزئیات...">${escapeHtml(t.note||'')}</textarea>
          </div>
        </details>
        <div class="todo-edit-grid-2">
          <div class="form-group">
            <label class="form-label">مسئول انجام</label>
            <select class="form-input" id="todo-assignee" onchange="_suggestTodoVisibilityForAssignee()"><option value="">کار شخصی من</option>${(_db.staff||[]).filter(staffIsPersonnel).map(s=>`<option value="${s.id}" ${String(t.assignee_id||'')===String(s.id)?'selected':''}>${escapeHtml(_todoStaffName(s))}</option>`).join('')}</select>
          </div>
          <div class="form-group">
            <label class="form-label">سطح دسترسی</label>
            <select class="form-input" id="todo-visibility"><option value="private" ${(t.visibility||'private')==='private'?'selected':''}>فقط من</option><option value="assignee" ${t.visibility==='assignee'?'selected':''}>فقط مسئول انجام</option><option value="selected" ${t.visibility==='selected'?'selected':''}>افراد انتخاب‌شده</option><option value="team" ${t.visibility==='team'?'selected':''}>اعضای مجاز تیم</option></select>
          </div>
        </div>
      </section>

      <section class="todo-edit-section">
        <div class="todo-edit-section-title"><span>زمان‌بندی</span><small>چه زمانی؟ چگونه تکرار شود؟</small></div>
        <div class="todo-edit-grid-3">
          <div class="form-group">
            <label class="form-label">⭐ ۳ کار اصلی امروز</label>
            <select class="form-input" id="todo-main-today-rank">
              <option value="0" ${(+t.main_today_rank||0)===0?'selected':''}>کار اصلی امروز نیست</option>
              <option value="1" ${(+t.main_today_rank||0)===1?'selected':''}>کار اصلی ۱ امروز</option>
              <option value="2" ${(+t.main_today_rank||0)===2?'selected':''}>کار اصلی ۲ امروز</option>
              <option value="3" ${(+t.main_today_rank||0)===3?'selected':''}>کار اصلی ۳ امروز</option>
            </select>
            <div style="font-size:10px;color:var(--text3);margin-top:5px;line-height:1.6">اگر تاریخ کار امروز باشد، بالای بخش امروز نمایش داده می‌شود.</div>
          </div>
          <div class="form-group">
            <label class="form-label">تاریخ</label>
            <div class="todo-date-quick-row">
              <button type="button" onclick="_setTodoDateShortcut('today')">امروز</button>
              <button type="button" onclick="_setTodoDateShortcut('tomorrow')">فردا</button>
              <button type="button" onclick="_setTodoDateShortcut('nextweek')">هفته دیگر</button>
            </div>
            <input class="form-input jdate" id="todo-date" value="${escapeHtml(t.date_jalali||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">ساعت</label>
            <input class="form-input" id="todo-time" type="time" value="${t.time||''}" onchange="_updateTodoEndPreview()" oninput="_updateTodoEndPreview()" style="direction:ltr">
          </div>
          <div class="form-group">
            <label class="form-label">مدت انجام</label>
            <div style="display:flex;align-items:center;gap:6px">
              <input class="form-input" id="todo-duration" type="number" min="5" step="5" value="${_todoDurationMinutes(t)||30}" onchange="_updateTodoEndPreview()" oninput="_updateTodoEndPreview()" style="direction:ltr;text-align:center">
              <span style="font-size:11px;color:var(--text3);white-space:nowrap">دقیقه</span>
            </div>
          </div>
        </div>
        <div id="todo-end-preview" class="todo-edit-summary-line">با انتخاب ساعت، زمان پایان نمایش داده می‌شود</div>
        <div class="todo-edit-grid-2">
          <div class="form-group">
            <label class="form-label">تکرار</label>
            <select class="form-input" id="todo-repeat" onchange="_onTodoRepeatChange(this.value)">
              <option value="none" ${repeatVal==='none'?'selected':''}>بدون تکرار</option>
              <option value="daily" ${repeatVal==='daily'?'selected':''}>روزانه</option>
              <option value="every2days" ${repeatVal==='every2days'?'selected':''}>یک روز در میان</option>
              <option value="weekly" ${repeatVal==='weekly'?'selected':''}>هفتگی</option>
              <option value="custom_weekdays" ${repeatVal==='custom_weekdays'?'selected':''}>روزهای خاص هفته</option>
              <option value="monthly" ${repeatVal==='monthly'?'selected':''}>ماهانه</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">یادآوری</label>
            <select class="form-input" id="todo-remind">
              <option value="0" ${!t.remind_min?'selected':''}>بدون یادآوری</option>
              <option value="5" ${t.remind_min===5?'selected':''}>۵ دقیقه قبل</option>
              <option value="10" ${t.remind_min===10?'selected':''}>۱۰ دقیقه قبل</option>
              <option value="15" ${t.remind_min===15?'selected':''}>۱۵ دقیقه قبل</option>
              <option value="30" ${t.remind_min===30?'selected':''}>۳۰ دقیقه قبل</option>
              <option value="60" ${t.remind_min===60?'selected':''}>۱ ساعت قبل</option>
              <option value="120" ${t.remind_min===120?'selected':''}>۲ ساعت قبل</option>
              <option value="1440" ${t.remind_min===1440?'selected':''}>۱ روز قبل</option>
            </select>
          </div>
        </div>
        <div id="weekdays-picker" style="display:${repeatVal==='custom_weekdays'?'block':'none'}">
          <label class="form-label" style="margin-bottom:8px">روزهای هفته:</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${weekBtns}</div>
          <input type="hidden" id="todo-weekdays" value="${t.weekdays||''}">
        </div>
      </section>

      <details class="todo-edit-accordion">
        <summary><span>سازمان‌دهی</span><span class="todo-acc-hint" id="todo-org-summary">${editCategoryLabels[t.category || 'general'] || 'عمومی'} • اولویت ${editPriorityLabels[t.priority || 'medium'] || 'متوسط'} • ${escapeHtml(editGoalLabel)}</span><span class="todo-acc-chevron">⌄</span></summary>
        <div class="todo-edit-accordion-body">
          <div class="todo-edit-subgrid">
            <div class="form-group">
              <label class="form-label">دسته‌بندی</label>
              <div style="display:flex;gap:6px;flex-wrap:wrap">
                ${_buildCategoryButtons(t.category||'general')}
                <input type="hidden" id="todo-category" value="${escapeHtml(t.category||'general')}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">اولویت</label>
              <div style="display:flex;gap:6px">
                ${_buildPriorityButtons(t.priority||'medium')}
                <input type="hidden" id="todo-priority" value="${t.priority||'medium'}">
              </div>
            </div>
          </div>
          <div class="form-group full" style="margin-top:12px">
            <label class="form-label">مرتبط با هدف (اختیاری)</label>
            <select class="form-input" id="todo-goal" onchange="_refreshTodoOrgSummary()">${_buildGoalSelectOptions(t.goal_id||'')}</select>
          </div>
        </div>
      </details>

      <details class="todo-edit-accordion">
        <summary><span>تنظیمات تکمیلی</span><span class="todo-acc-hint" id="todo-extra-summary">${escapeHtml(editExtraSummary)}</span><span class="todo-acc-chevron">⌄</span></summary>
        <div class="todo-edit-accordion-body">
          <div class="todo-edit-grid-2">
            <div class="form-group">
              <label class="form-label">گزارش انجام کار</label>
              <select class="form-input" id="todo-requires-report" onchange="_refreshTodoExtraSummary()"><option value="none" ${(t.requires_report||'none')==='none'?'selected':''}>گزارش لازم نیست</option><option value="optional" ${t.requires_report==='optional'?'selected':''}>گزارش اختیاری</option><option value="required" ${t.requires_report==='required'?'selected':''}>گزارش الزامی</option></select>
            </div>
            <div class="form-group">
              <label class="form-label">فایل و پیوست</label>
              <select class="form-input" id="todo-requires-attachment" onchange="_refreshTodoExtraSummary()"><option value="none" ${(t.requires_attachment||'none')==='none'?'selected':''}>فایل لازم نیست</option><option value="optional" ${t.requires_attachment==='optional'?'selected':''}>فایل اختیاری</option><option value="required" ${t.requires_attachment==='required'?'selected':''}>فایل الزامی</option></select>
            </div>
          </div>
          <label style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:12px;color:var(--text2);cursor:pointer"><input type="checkbox" id="todo-requires-approval" onchange="_refreshTodoExtraSummary()" ${t.requires_approval?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)"> نیاز به تأیید مدیر دارد</label>
          ${t.staff_report ? `<div style="margin-top:10px;padding:9px;border-radius:9px;background:rgba(62,207,142,.07);border:1px solid rgba(62,207,142,.22);font-size:12px;color:var(--text2);line-height:1.8"><b style="color:var(--green)">گزارش انجام کار:</b><br>${escapeHtml(t.staff_report)}</div>` : ''}
          <div style="margin-top:10px;font-size:11px;padding:7px 10px;border-radius:8px;
            background:${'Notification' in window && Notification.permission==='granted'?'rgba(62,207,142,.1)':'rgba(251,191,36,.1)'};
            color:${'Notification' in window && Notification.permission==='granted'?'var(--green)':'var(--amber)'}">
            ${'Notification' in window && Notification.permission==='granted'
              ? 'نوتیفیکیشن فعال است'
              : 'نوتیفیکیشن غیرفعال — <button onclick="_requestNotifPermission()" style="background:none;border:none;cursor:pointer;color:var(--amber);font-size:11px;font-family:var(--font);text-decoration:underline">فعال‌سازی</button>'}
          </div>
          ${_todoGcalCheckboxHtml(t.sync_gcal)}
        </div>
      </details>
    </div>
  `, [
    {label: '💾 ذخیره', cls: 'btn-primary', action: 'updateTodo(' + id + ')'},
    {label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()'},
  ], { overlayClass: 'todo-edit-modal' });
  setTimeout(() => { initDatePickers(); _updateTodoEndPreview(); }, 50);
}


function _setTodoDateShortcut(when) {
  const [jy, jm, jd] = _todayJalali();
  let targetJalali;
  if (when === 'today') {
    targetJalali = _formatJalali(jy, jm, jd);
  } else if (when === 'tomorrow') {
    const greg = jalaliToGregorian(jy, jm, jd);
    const d = new Date(greg[0], greg[1]-1, greg[2]+1);
    const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
    targetJalali = _formatJalali(...j);
  } else if (when === 'nextweek') {
    const greg = jalaliToGregorian(jy, jm, jd);
    const d = new Date(greg[0], greg[1]-1, greg[2]+7);
    const j = gregorianToJalali(d.getFullYear(), d.getMonth()+1, d.getDate());
    targetJalali = _formatJalali(...j);
  }
  const inp = document.getElementById('todo-date');
  if (inp && targetJalali) inp.value = targetJalali;
}


function _suggestTodoVisibilityForAssignee() {
  const assignee = document.getElementById('todo-assignee')?.value || '';
  const visibility = document.getElementById('todo-visibility');
  if (!visibility) return;
  if (assignee && (!visibility.value || visibility.value === 'private')) visibility.value = 'assignee';
  if (!assignee && visibility.value === 'assignee') visibility.value = 'private';
}


function _refreshTodoOrgSummary() {
  const el = document.getElementById('todo-org-summary');
  if (!el) return;
  const catLabels = {clients:'مشتریان', routine:'روتین‌ها', general:'عمومی', personal:'شخصی'};
  const priorityLabels = {low:'پایین', medium:'متوسط', high:'بالا', urgent:'فوری'};
  const cat = document.getElementById('todo-category')?.value || 'general';
  const priority = document.getElementById('todo-priority')?.value || 'medium';
  const goal = document.getElementById('todo-goal');
  const goalText = goal?.value ? (goal.options[goal.selectedIndex]?.text || 'هدف انتخاب‌شده') : 'بدون هدف';
  el.textContent = (catLabels[cat] || 'عمومی') + ' • اولویت ' + (priorityLabels[priority] || 'متوسط') + ' • ' + goalText;
}


function _refreshTodoExtraSummary() {
  const el = document.getElementById('todo-extra-summary');
  if (!el) return;
  const reportLabels = {none:'گزارش لازم نیست', optional:'گزارش اختیاری', required:'گزارش الزامی'};
  const attachLabels = {none:'بدون فایل', optional:'فایل اختیاری', required:'فایل الزامی'};
  const report = document.getElementById('todo-requires-report')?.value || 'none';
  const attach = document.getElementById('todo-requires-attachment')?.value || 'none';
  const approval = document.getElementById('todo-requires-approval')?.checked;
  el.textContent = [
    reportLabels[report] || 'گزارش لازم نیست',
    approval ? 'تأیید مدیر فعال' : 'بدون تأیید مدیر',
    attachLabels[attach] || 'بدون فایل'
  ].join(' • ');
}


function _setTodoPriority(btn, val) {
  const colors = {low:'#60a5fa', medium:'#fbbf24', high:'#f97316', urgent:'#ef4444'};
  document.querySelectorAll('[data-priority]').forEach(b => {
    const c = colors[b.dataset.priority];
    b.style.borderColor = 'var(--border2)';
    b.style.background = 'var(--bg3)';
    b.style.color = 'var(--text2)';
  });
  btn.style.borderColor = colors[val];
  btn.style.background = colors[val] + '22';
  btn.style.color = colors[val];
  const inp = document.getElementById('todo-priority');
  if (inp) inp.value = val;
  _refreshTodoOrgSummary();
}


function _buildPriorityButtons(selected) {
  const colors = {low:'#60a5fa', medium:'#fbbf24', high:'#f97316', urgent:'#ef4444'};
  const labels = {low:'پایین', medium:'متوسط', high:'بالا', urgent:'فوری'};
  return ['low','medium','high','urgent'].map(priority => {
    const sel = selected === priority;
    const border = sel ? colors[priority] : 'var(--border2)';
    const bg = sel ? colors[priority] + '22' : 'var(--bg3)';
    const color = sel ? colors[priority] : 'var(--text2)';
    return `<button type="button" onclick="_setTodoPriority(this,'${priority}')" data-priority="${priority}"
      style="flex:1;padding:6px 4px;border-radius:8px;font-size:11px;font-weight:600;cursor:pointer;font-family:var(--font);border:2px solid ${border};background:${bg};color:${color}">${labels[priority]}</button>`;
  }).join('');
}


function _buildCategoryButtons(selected) {
  const cats = [
    {val:'clients', label:'👥 مشتریان', color:'#f472b6'},
    {val:'routine', label:'🔄 روتین‌ها', color:'#34d399'},
    {val:'general', label:'🌐 عمومی',   color:'#60a5fa'},
    {val:'personal',label:'🧘 شخصی',    color:'#a78bfa'},
  ];
  return cats.map(cat => {
    const sel = selected === cat.val;
    const border = sel ? cat.color : 'var(--border2)';
    const bg     = sel ? cat.color + '22' : 'var(--bg3)';
    const color  = sel ? cat.color : 'var(--text2)';
    return '<button type="button" onclick="_setTodoCategory(this,&apos;' + cat.val + '&apos;)" data-cat="' + cat.val + '" ' +
      'style="flex:1;min-width:80px;padding:7px 4px;border-radius:8px;font-size:12px;font-weight:600;' +
      'cursor:pointer;font-family:var(--font);border:2px solid ' + border + ';background:' + bg + ';color:' + color + '">' +
      cat.label + '</button>';
  }).join('');
}


function _setTodoCategory(btn, val) {
  const colors = {clients:'#f472b6', routine:'#34d399', general:'#60a5fa', personal:'#a78bfa'};
  document.querySelectorAll('[data-cat]').forEach(b => {
    b.style.borderColor = 'var(--border2)';
    b.style.background = 'var(--bg3)';
    b.style.color = 'var(--text2)';
  });
  btn.style.borderColor = colors[val] || '#60a5fa';
  btn.style.background = (colors[val] || '#60a5fa') + '22';
  btn.style.color = colors[val] || '#60a5fa';
  const inp = document.getElementById('todo-category');
  if (inp) inp.value = val;
  _refreshTodoOrgSummary();
}


async function updateTodo(id) {
  _todosInit();
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  if (!_todoCanEdit(t)) { showToast('برای ویرایش این کار دسترسی نداری', 'error'); return; }
  const title = document.getElementById('todo-title')?.value.trim();
  if (!title) { showToast('عنوان را وارد کنید', 'error'); return; }
  const repeat = document.getElementById('todo-repeat')?.value || 'none';
  const weekdays = repeat === 'custom_weekdays'
    ? (document.getElementById('todo-weekdays')?.value || '')
    : '';
  const remindMin = parseInt(document.getElementById('todo-remind')?.value || '0');
  const dateJalali = document.getElementById('todo-date')?.value.trim() || t.date_jalali;
  const time = document.getElementById('todo-time')?.value || '';
  const durationMin = time ? (_todoDurationMinutes(document.getElementById('todo-duration')?.value || '30') || 30) : 0;
  const mainTodayRank = Math.max(0, Math.min(3, parseInt(document.getElementById('todo-main-today-rank')?.value || '0', 10) || 0));
  const normalizedMainTodayRank = _jalaliKey(dateJalali) === _jalaliToday() ? mainTodayRank : 0;
  if (remindMin > 0 && !time) {
    showToast('برای ارسال نوتیفیکیشن، ساعت کار را مشخص کن', 'error');
    return;
  }
  if (remindMin > 0 && !(await _ensureReminderPushEnabled())) return;
  const priority = document.getElementById('todo-priority')?.value || 'medium';

  const category2 = document.getElementById('todo-category')?.value || t.category || 'general';
  const goalId2 = document.getElementById('todo-goal')?.value || '';
  const syncGcalWanted = !!document.getElementById('todo-gcal')?.checked;
  const assigneeId = document.getElementById('todo-assignee')?.value || '';
  const assignee = (_db.staff || []).find(s => staffIsPersonnel(s) && String(s.id) === String(assigneeId));
  const wasSynced = !!t.sync_gcal;
  const prevEventId = t.gcal_event_id;
  const prevCalendarId = t.gcal_calendar_id || _gcal.calendarId();
  const originalScheduledDate = _todoScheduledDate(t);
  if (normalizedMainTodayRank > 0) {
    (_db.todos || []).forEach(other => {
      if (String(other.id) !== String(t.id) && !other.archived && !other.done && _jalaliKey(other.date_jalali || other.scheduled_date || other.scheduledDate || '') === _jalaliToday() && +other.main_today_rank === normalizedMainTodayRank) {
        other.main_today_rank = 0;
        other.updated_at = new Date().toISOString();
      }
    });
  }
  const isPastRecurringOccurrence = _isTodoRecurring(t) && originalScheduledDate && _jalaliKey(originalScheduledDate) < _jalaliToday();
  if (isPastRecurringOccurrence) {
    const editOnlyThis = confirm('این کار یک نوبت عقب‌افتاده از کار تکرارشونده است. تایید = فقط همین نوبت ویرایش شود. انصراف = کل زنجیره/قالب تکرار ویرایش شود.');
    if (editOnlyThis) {
      const occurrence = {
        ...t,
        id: _allocateTodoId(),
        recurrence_parent_id: _todoRootId(t),
        title,
        note: document.getElementById('todo-note')?.value.trim() || '',
        date_jalali: dateJalali,
        scheduled_date: dateJalali,
        scheduledDate: dateJalali,
        time,
        duration_min: durationMin,
        repeat: 'none',
        weekdays: '',
        priority,
        category: category2,
        main_today_rank: normalizedMainTodayRank,
        goal_id: goalId2 ? +goalId2 : null,
        remind_min: remindMin,
        sync_gcal: syncGcalWanted,
        gcal_event_id: null,
        gcal_calendar_id: syncGcalWanted ? _gcal.calendarId() : null,
        done: false,
        done_at: null,
        completedAt: null,
        completed_at: null,
        status: 'pending',
        archived: false,
        _occurrence: true,
        updated_at: new Date().toISOString(),
      };
      _db.todos.push(occurrence);
      _advanceRecurringTodoOccurrence(t, originalScheduledDate);
      _save();
      if (remindMin > 0 && time && dateJalali) _scheduleTodoNotification(occurrence.id, title, dateJalali, time, remindMin);
      if (syncGcalWanted && dateJalali) _gcal.upsertEvent(occurrence);
      closeModal();
      showToast('فقط همین نوبت ویرایش شد؛ زنجیره تکرار بدون تغییر ادامه دارد.', 'success');
      renderTodoList();
      return;
    }
  }
  Object.assign(t, { title,
    note: document.getElementById('todo-note')?.value.trim() || '',
    manager_note: document.getElementById('todo-note')?.value.trim() || '',
    assignee_id: assignee ? assignee.id : null,
    assignee_email: assignee?.email || '',
    visibility: document.getElementById('todo-visibility')?.value || (assignee ? 'assignee' : 'private'),
    requires_report: document.getElementById('todo-requires-report')?.value || 'none',
    requires_attachment: document.getElementById('todo-requires-attachment')?.value || 'none',
    requires_approval: !!document.getElementById('todo-requires-approval')?.checked,
    date_jalali: dateJalali, scheduled_date: dateJalali, scheduledDate: dateJalali, time, duration_min: durationMin, repeat, weekdays,
    priority, category: category2, main_today_rank: normalizedMainTodayRank, goal_id: goalId2 ? +goalId2 : null, remind_min: remindMin,
    sync_gcal: syncGcalWanted,
    updated_at: new Date().toISOString(),
  });
  _save(true, { scheduleServerSync: false });

  if (remindMin > 0 && time && dateJalali) {
    _scheduleTodoNotification(t.id, title, dateJalali, time, remindMin);
  }

  // همگام‌سازی با Google Calendar
  if (syncGcalWanted && dateJalali) {
    try { _gcal.upsertEvent(t); } catch(e) { console.warn('Google Calendar sync failed:', e.message); }
  } else if (wasSynced && !syncGcalWanted && prevEventId) {
    try { _gcal.deleteEvent(prevEventId, prevCalendarId); } catch(e) { console.warn('Google Calendar delete failed:', e.message); }
    t.gcal_event_id = null;
    t.gcal_calendar_id = null;
    _save(false);
  }

  closeModal();
  showToast('ذخیره شد ✓', 'success');
  renderTodoList();
  if (normalizedMainTodayRank > 0) void _syncToServer();
  else void _syncTodoDelta(t, 'edit');
}


async function deleteTodo(id) {
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  if (!_todoCanDelete(t)) { showToast('برای حذف این کار دسترسی نداری', 'error'); return; }
  const scheduledDate = _todoScheduledDate(t);
  if (_isTodoRecurring(t) && scheduledDate && _jalaliKey(scheduledDate) < _jalaliToday()) {
    if (!confirm('فقط همین نوبت عقب‌افتاده حذف شود؟ قالب تکرار و نوبت امروز حذف نمی‌شود.')) return;
    _deleteTodoOccurrenceOnly(t, scheduledDate);
    _save();
    await _syncToServer();
    if (_teamAccessSession() && (_db._lastSaved || 0) > (window._teamLastOwnerDataSavedAt || 0)) {
      showToast('حذف روی حساب اصلی ذخیره نشد؛ دسترسی هم‌تیمی را دوباره باز کن', 'error');
      return;
    }
    showToast('فقط همان نوبت حذف شد؛ تکرار کار حفظ شد.', 'success');
    renderTodoList();
    return;
  }
  if (!confirm('این کار حذف شود؟')) return;
  if (typeof _automationDismissPackageDueTodo === 'function' && _automationDismissPackageDueTodo(t)) {
    _save(true, { scheduleServerSync: false });
    void _syncTodoDelta(t, 'edit');
    showToast('اعلان این سررسید بسته شد', 'success');
    renderTodoList();
    return;
  }
  if (t && t.gcal_event_id) {
    _gcal.deleteEvent(t.gcal_event_id, t.gcal_calendar_id);
  }
  _rememberDeletedTodos([t.id, _todoRootId(t)]);
  _db.todos = _db.todos.filter(x => x.id != id);
  _save();
  await _syncToServer();
  if (_teamAccessSession() && (_db._lastSaved || 0) > (window._teamLastOwnerDataSavedAt || 0)) {
    showToast('حذف روی حساب اصلی ذخیره نشد؛ دسترسی هم‌تیمی را دوباره باز کن', 'error');
    return;
  }
  showToast('کار حذف شد', 'success');
  renderTodoList();
}


async function _deleteTodoCompletely(id, options = {}) {
  if (_teamAccessSession() && !window._teamOwnerDataReady) {
    const loaded = await _loadFromServer();
    if (!loaded && !window._teamOwnerDataReady) {
      showToast('حذف انجام نشد؛ داده‌های حساب اصلی هنوز کامل لود نشده است', 'error');
      return;
    }
  }
  const t = _db.todos.find(x => x.id == id);
  if (!t) return;
  if (!_todoCanDelete(t)) { showToast('برای حذف این کار دسترسی نداری', 'error'); return; }
  const rootId = String(_todoRootId(t));
  const isSeries = _isTodoRecurring(t) || (_db.todos || []).some(x => String(_todoRootId(x)) === rootId && String(x.id) !== String(t.id));
  const msg = isSeries
    ? 'این کار تکرارشونده است. حذف کامل شود؟'
    : 'این کار حذف شود؟';
  if (!confirm(msg)) return;
  if (typeof _automationDismissPackageDueTodo === 'function' && _automationDismissPackageDueTodo(t)) {
    _save(true, { scheduleServerSync: false });
    void _syncTodoDelta(t, 'edit');
    _refreshTodoAfterDelete(options.refresh);
    showToast('اعلان این سررسید بسته شد', 'success');
    return;
  }
  const removedTodos = (_db.todos || []).filter(x => String(x.id) === String(t.id) || String(_todoRootId(x)) === rootId);
  removedTodos.forEach(x => { if (x.gcal_event_id) _gcal.deleteEvent(x.gcal_event_id, x.gcal_calendar_id); });
  _rememberDeletedTodos([t.id, rootId, ...removedTodos.map(x => x.id)]);
  _db.todos = (_db.todos || []).filter(x => String(x.id) !== String(t.id) && String(_todoRootId(x)) !== rootId);
  _save(true, { scheduleServerSync: false });
  removedTodos.forEach(x => {
    document.querySelectorAll(`[data-todo-id="${CSS.escape(String(x.id))}"]`).forEach(el => el.remove());
  });
  _refreshTodoAfterDelete(options.refresh);
  clearTimeout(window._serverSyncTimer);
  const res = await _syncTodoDelta(t, 'delete', removedTodos);
  if (_sbUser && (!res || !res.ok)) {
    showToast('حذف روی حساب اصلی ذخیره نشد؛ دسترسی هم‌تیمی را دوباره باز کن', 'error');
    return;
  }
  showToast('کار حذف شد', 'success');
}


async function _deleteStaffTodoCompletely(id) {
  _todoActiveTab = 'staff';
  _todoStaffTabExplicit = true;
  await _deleteTodoCompletely(id, { refresh: 'staff' });
}


function _refreshTodoAfterDelete(refresh = '') {
  if (refresh === 'staff' || _todoActiveTab === 'staff') {
    _todoActiveTab = 'staff';
    renderTodoList();
    return;
  }
  renderTodoList();
}


async function openTodoArchive(activeArchive = window._todoArchiveTab || 'mine') {
  _todosInit();
  window._todoArchiveTab = activeArchive;
  const archivePaging = _todoPagingState(true);
  if (!archivePaging.done) await _loadTodoPage(true);

  // Safety: اگه در حال impersonate هستیم و todos خالیه، یه بار دیگه از سرور بکش
  // (جلوگیری از باگ احتمالی sync بعد از رفرش صفحه)
  if (window._impersonating && (!_db.todos || _db.todos.length === 0)) {
    try {
      const dataRes = await _apiFetch('/api/data/' + window._impersonating.userId);
      if (dataRes.ok) {
        const ct = dataRes.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await dataRes.json();
          if (json.data && Object.keys(json.data).length > 0) {
            _db = json.data;
            _migrate(_db);
            _persistDatabaseSnapshot(window._activeDBKey, _db);
          }
        }
      }
    } catch(e) {}
  }

  // چک اتوماتیک: اگه الان ۱ فروردین هست، بایگانی سال قبل رو پاک کن
  const todayJ = _todayJalaliStr();
  const todayParts = _jalaliParse(todayJ);
  if (archivePaging.done && todayParts[1] === 1 && todayParts[2] === 1) {
    const lastClear = localStorage.getItem('tp_archive_clear_year');
    if (lastClear !== String(todayParts[0])) {
      _db.todos = _db.todos.filter(t => !t.archived);
      _save();
      localStorage.setItem('tp_archive_clear_year', String(todayParts[0]));
    }
  }

  // نمایش همه کارهای done (چه archived شده چه امروز انجام شده)
  const allArchived = _db.todos.filter(t => (t.archived || t.done) && _todoCanView(t))
    .sort((a,b) => new Date(b.done_at||0) - new Date(a.done_at||0));
  const isStaffArchiveTodo = (t) => !!(t.assignee_id || t.assignee_email || t.staff_id);
  const mineArchived = allArchived.filter(_todoIsMineScope);
  const staffArchived = allArchived.filter(t => !_todoIsMineScope(t) && isStaffArchiveTodo(t));
  const archived = activeArchive === 'staff' ? staffArchived : mineArchived;
  const archiveTabs = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
      <button class="btn ${activeArchive === 'mine' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="openTodoArchive('mine')" style="justify-content:center">
        بایگانی کارهای من <span style="opacity:.75">(${fa(mineArchived.length)})</span>
      </button>
      <button class="btn ${activeArchive === 'staff' ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="openTodoArchive('staff')" style="justify-content:center">
        بایگانی کارهای پرسنل <span style="opacity:.75">(${fa(staffArchived.length)})</span>
      </button>
    </div>`;

  if (allArchived.length === 0) {
    openModal('📦 بایگانی کارها', archiveTabs + '<p style="color:var(--text3);font-size:13px;text-align:center;padding:30px">بایگانی خالیه 🎉</p>',
      [{label:'بستن', cls:'btn-ghost', action:'closeModal()'}]);
    return;
  }

  // دسته‌بندی بر اساس هفته/ماه/سال جاری
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0,0,0,0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear  = new Date(now.getFullYear(), 0, 1);

  const groups = [
    { label: '📅 این هفته',  items: [] },
    { label: '🗓 این ماه',   items: [] },
    { label: '📆 امسال',     items: [] },
    { label: '🗃 قدیمی‌تر',  items: [] },
  ];

  archived.forEach(t => {
    const d = t.done_at ? new Date(t.done_at) : new Date(0);
    if (d >= startOfWeek)       groups[0].items.push(t);
    else if (d >= startOfMonth) groups[1].items.push(t);
    else if (d >= startOfYear)  groups[2].items.push(t);
    else                        groups[3].items.push(t);
  });

  const renderRow = (t) => {
    const catMap = {clients:'👥',routine:'🔄',general:'🌐',personal:'🧘'};
    const catIcon = t.category ? (catMap[t.category] || '') : '';
    const assignee = _todoAssigneeLabel(t);
    const todayK = _jalaliKey(_todayJalaliStr());
    const doneParts = t.done_at ? _jalaliFromInstant(t.done_at) : null;
    const doneDay = doneParts ? _jalaliKey(_formatJalali(...doneParts)) : 0;
    const isToday = doneDay === todayK;
    const statusBadge = isToday
      ? '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(62,207,142,.15);color:#3ecf8e;font-weight:700">امروز</span>'
      : '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:rgba(124,106,247,.12);color:#9d8fff;font-weight:600">بایگانی</span>';
    const doneDate = doneParts ? DateService.disp(_formatJalali(...doneParts)) : '';
    return '<div id="archive-row-' + t.id + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:10px;margin-bottom:6px;border:1px solid var(--border)">' +
      '<span style="font-size:15px;flex-shrink:0">✅</span>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap">' +
          '<span style="font-size:13px;font-weight:600;text-decoration:line-through;color:var(--text2)">' + escapeHtml(t.title) + '</span>' +
          statusBadge +
          (catIcon ? '<span style="font-size:11px">' + catIcon + '</span>' : '') +
        '</div>' +
        '<div style="font-size:10px;color:var(--text3);display:flex;gap:8px;flex-wrap:wrap">' +
          (doneDate ? '<span>✓ ' + doneDate + '</span>' : '') +
          (t.date_jalali ? '<span>📅 ' + DateService.disp(t.date_jalali) + '</span>' : '') +
          (t.time ? '<span>⏰ ' + _todoTimeRangeLabel(t) + '</span>' : '') +
          (assignee ? '<span>👤 ' + escapeHtml(assignee) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
        '<button onclick="_restoreTodo(' + t.id + ')" style="font-size:10px;padding:4px 8px;background:var(--bg2);border:1px solid var(--accent);border-radius:6px;cursor:pointer;color:var(--accent);white-space:nowrap;font-weight:600">↩️ بازگشت</button>' +
        '<button onclick="_deleteTodoForever(' + t.id + ')" style="font-size:10px;padding:4px 8px;background:var(--bg2);border:1px solid rgba(248,113,113,.4);border-radius:6px;cursor:pointer;color:var(--red);white-space:nowrap;font-weight:600">🗑 حذف</button>' +
      '</div>' +
    '</div>';
  };

  const rows = groups
    .filter(g => g.items.length > 0)
    .map(g => `
      <div style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);padding:6px 4px;border-bottom:1px solid var(--border);margin-bottom:8px">
          ${escapeHtml(g.label)} <span style="opacity:.6">(${fa(g.items.length)})</span>
        </div>
        ${g.items.map(renderRow).join('')}
      </div>`).join('');

  const clearAllBtn = `
    <div style="margin-top:4px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="btn btn-danger" style="width:100%;font-size:12px" onclick="_clearTodoArchive('${activeArchive}')">
        🗑 حذف همه ${activeArchive === 'staff' ? 'بایگانی کارهای پرسنل' : 'بایگانی کارهای من'} (${fa(archived.length)} کار)
      </button>
    </div>`;

  openModal('📦 بایگانی کارها', `
    ${archiveTabs}
    <div style="font-size:11px;color:var(--text3);margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
      <span>${activeArchive === 'staff' ? 'بایگانی کارهای پرسنل' : 'بایگانی کارهای من'} — ${fa(archived.length)} کار انجام‌شده</span>
      <span style="opacity:.6">هر سال ۱ فروردین خودکار پاک می‌شه</span>
    </div>
    <div style="max-height:420px;overflow-y:auto">${rows || '<p style="color:var(--text3);font-size:13px;text-align:center;padding:30px">در این بخش هنوز کاری نیست.</p>'}</div>
    ${archivePaging.done ? '' : '<button type="button" class="todo-show-more" onclick="_loadMoreTodoArchive()">دریافت بایگانی بیشتر از سرور</button>'}
    ${clearAllBtn}
  `, [{label:'بستن', cls:'btn-ghost', action:'closeModal()'}]);
}


async function _loadMoreTodoArchive() {
  await _loadTodoPage(true);
  return openTodoArchive(window._todoArchiveTab || 'mine');
}


function _clearTodoArchive(kind = window._todoArchiveTab || 'mine') {
  const isStaffArchiveTodo = (t) => !!(t.assignee_id || t.assignee_email || t.staff_id);
  const label = kind === 'staff' ? 'بایگانی کارهای پرسنل' : 'بایگانی کارهای من';
  if (!confirm('همه ' + label + ' پاک شود؟')) return;
  _db.todos = _db.todos.filter(t => {
    if (!t.archived) return true;
    const isStaff = isStaffArchiveTodo(t);
    return kind === 'staff' ? !isStaff : isStaff;
  });
  _save();
  closeModal();
  showToast(label + ' پاک شد', 'error');
}


function _restoreTodo(id) {
  const t = _db.todos.find(x => x.id == id);
  if (t) { t.archived = false; t.done = false; t.done_at = null; _save(); closeModal(); renderTodoList(); }
}

function _deleteTodoForever(id) {
  const t = _db.todos.find(x => x.id == id);
  if (t && t.gcal_event_id) {
    _gcal.deleteEvent(t.gcal_event_id, t.gcal_calendar_id);
  }
  _rememberDeletedTodos([id, t ? _todoRootId(t) : id]);
  _db.todos = _db.todos.filter(x => x.id != id);
  _save(); openTodoArchive(window._todoArchiveTab || 'mine');
}


