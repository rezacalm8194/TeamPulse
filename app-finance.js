// TeamPulse deferred UI — income, families, reminders.
// Loaded when those pages open.
async function renderPurchases(search = '') {
  updateTopbarActions(`
    <div class="table-search"><svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="2"/><path d="M15 15l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input placeholder="جستجو با نام شاگرد..." oninput="renderPurchases(this.value)" value="${escapeHtml(search)}">
    </div>`);
  let packages = await window.api.packages.getAll();
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    packages = packages.filter(p => `${p.name} ${p.lname}`.toLowerCase().includes(q));
  }
  let html = `<div class="table-card">
    <div class="table-header"><span class="title">🛒 تاریخچه کل فروش ها (${fa(packages.length)} مورد)</span></div>
    <table><thead><tr><th>${META.entitySingular||'شاگرد'}</th><th>نوع خرید</th><th>مجری</th><th>مبلغ کل</th><th>شروع / سررسید پرداخت</th><th>تکرار</th><th>توضیحات</th><th>عملیات</th></tr></thead><tbody>`;
  if (packages.length === 0) {
    html += `<tr><td colspan="8"><div class="empty"><span>🛒</span>خریدی ثبت نشده</div></td></tr>`;
  } else {
    packages.forEach(p => {
      html += `<tr class="student-record-row" onclick="openStudentDetail(${s.id})" title="مشاهده جزئیات پرونده ${escapeHtml(`${s.name} ${s.lname}`.trim())}">
        <td style="font-weight:500">${escapeHtml(p.name)} ${escapeHtml(p.lname)}</td>
        <td><span class="tag" style="background:${p.pkg_color}22;color:${p.pkg_color}">${escapeHtml(p.type_label)}</span></td>
        <td style="font-size:11px;color:var(--text2)">${escapeHtml(p.staff_name||'—')}</td>
        <td><span class="amount amount-paid">${fmt(p.total_amount)} تومان</span></td>
        <td style="color:var(--text2)">
          <div>شروع: ${DateService.disp(p.start_date)||'—'}</div>
          <div style="font-size:10px;color:${_isPackageChargeable(p)?'var(--green)':'var(--amber)'};margin-top:2px">سررسید پرداخت: ${DateService.disp(p.payment_due_date)||'—'}${_isPackageChargeable(p)?'':' · آینده'}</div>
        </td>
        <td style="font-size:11px;color:var(--text2)">${p.repeat_months>0?`هر ${fa(p.repeat_months)} ماه`:'یک‌بار'}</td>
        <td style="font-size:11px;color:var(--text3)">${escapeHtml(p.note||'')}</td>
        <td>
          <div style="display:flex;align-items:center;gap:5px">
            <button class="btn btn-ghost btn-sm" onclick="openEditPackage(${p.id})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deletePackage(${p.id})">🗑</button>
          </div>
        </td>
      </tr>`;
    });
  }
  html += `</tbody></table></div>`;
  setContent(html);
  if (search) {
    requestAnimationFrame(() => {
      const sp = document.querySelector('#topbar-actions .table-search input') ||
                 document.querySelector('.table-search input');
      if (sp) { sp.focus(); try { sp.setSelectionRange(search.length, search.length); } catch(e){} }
    });
  }
}


async function openEditPackage(id) {
  const packages = await window.api.packages.getAll();
  const p = packages.find(x => x.id === id);
  if (!p) return;
  const pts = await window.api.packageTypes.getAll();
  const typeOptions = pts.map(pt => `<option value="${pt.id}" ${pt.id===p.type_id?'selected':''}>${escapeHtml(pt.label)}</option>`).join('');
  openModal(`✏️ ویرایش خرید — ${escapeHtml(p.name)} ${escapeHtml(p.lname)}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">نوع خرید</label>
        <select class="form-select" id="ep-type" onchange="onPurchaseTypeChange('ep')">${typeOptions}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">مجری خدمت / پرسنل</label>
        <select class="form-select" id="ep-staff">${purchaseStaffOptionsHtml(p.type_id, p.staff_id || '')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ کل (تومان)</label>
        <input class="form-input amount-input" id="ep-total" type="number" value="${p.total_amount}">
      </div>
      <div class="form-group">
        <label class="form-label">بدهی قبلی (تومان)</label>
        <input class="form-input amount-input" id="ep-initial" type="number" value="${p.initial_cost||0}">
      </div>
      <div class="form-group">
        ${calendarDateFieldHtml('ep-start', p.start_date||'', 'تاریخ شروع')}
      </div>
      <div class="form-group">
        ${calendarDateFieldHtml('ep-payment-due', p.payment_due_date || '', 'سررسید اولین پرداخت', false)}
        <p style="font-size:11px;color:var(--text3);margin-top:4px">اختیاری. اگر خالی بماند یادآوری این خرید حذف می‌شود.</p>
      </div>
      <div class="form-group">
        <label class="form-label">🔁 تکرار</label>
        <select class="form-select" id="ep-repeat">
          <option value="0" ${!p.repeat_months?'selected':''}>بدون تکرار</option>
          <option value="1" ${p.repeat_months===1?'selected':''}>هر ۱ ماه</option>
          <option value="3" ${p.repeat_months===3?'selected':''}>هر ۳ ماه</option>
          <option value="6" ${p.repeat_months===6?'selected':''}>هر ۶ ماه</option>
          <option value="12" ${p.repeat_months===12?'selected':''}>هر ۱۲ ماه</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">توضیحات خرید</label>
        <input class="form-input" id="ep-note" value="${escapeHtml(p.note||'')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditPackage(${id}, ${p.student_id})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
  onPurchaseTypeChange('ep');
}

async function saveEditPackage(id, studentId) {
  const startDate = readCalendarDateField('ep-start');
  const paymentDueDate = readCalendarDateField('ep-payment-due');
  const repeat_months = +(document.getElementById('ep-repeat')?.value||0);
  if (repeat_months > 0 && !paymentDueDate) {
    showToast('برای تکرار، سررسید پرداخت را وارد کنید یا تکرار را روی «بدون تکرار» بگذارید', 'error');
    return;
  }
  await window.api.packages.update({
    id, type_id: +(document.getElementById('ep-type')?.value||0),
    staff_id: document.getElementById('ep-staff')?.value || null,
    total_amount: +(document.getElementById('ep-total')?.value||0),
    initial_cost: +(document.getElementById('ep-initial')?.value||0),
    start_date: startDate,
    payment_due_date: paymentDueDate,
    repeat_months,
    note: document.getElementById('ep-note')?.value,
  });
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  _paymentsTab = 'purchases';
  if (currentPage === 'payments') await renderPayments();
  else { allStudents = await window.api.students.getAll(); await openStudentDetail(studentId); }
}

async function deletePackage(id) {
  if (!confirm('این خرید و یادآوری‌های مرتبط حذف شود؟')) return;
  await window.api.packages.delete(id);
  showToast('حذف شد', 'error');
  // حذف فوری از DOM بدون نیاز به رفرش
  const el = document.getElementById('pkg-row-' + id);
  if (el) {
    el.style.transition = 'opacity .2s, max-height .2s';
    el.style.opacity = '0';
    el.style.maxHeight = '0';
    el.style.overflow = 'hidden';
    setTimeout(() => el.remove(), 220);
  }
  _paymentsTab = 'purchases';
  // آپدیت آمار بدون re-render کامل
  if (currentPage === 'payments') await renderPayments();
  else if (typeof openStudentDetail === 'function') {
    // آپدیت modal جزئیات اگه باز است
    const sid = allStudents.find(s => s.packages?.some(p => p.id === id))?.id;
    if (sid) setTimeout(() => openStudentDetail(sid), 300);
  }
}

// ── Edit / Delete payment ──────────────────────────────────────────────────────

async function openEditPayment(id) {
  const payments = await window.api.payments.getAll();
  const p = payments.find(x => x.id === id);
  if (!p) return;
  const packages = await window.api.packages.getByStudent(p.student_id);
  const pkgOptions = paymentPackageOptionsHtml(packages, { includeNew: false, selectedId: p.package_id || null });

  openModal(`✏️ ویرایش پرداخت — ${escapeHtml(p.name)} ${escapeHtml(p.lname)}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">ثبت این پرداخت بابت</label>
        <select class="form-select" id="ep-pkg">${pkgOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ دریافتی الان *</label>
        <input class="form-input amount-input" id="ep-amount" type="number" min="0" value="${p.amount}">
      </div>
      <div class="form-group">
        <label class="form-label">واحد پول</label>
        <select class="form-select" id="ep-currency">${currencyOptions(p.currency||'تومان')}</select>
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی) *</label>
        <input class="form-input jdate" id="ep-date" value="${p.date_jalali}">
      </div>
      <div class="form-group">
        <label class="form-label">بابت / شماره پیگیری</label>
        <input class="form-input" id="ep-method" value="${escapeHtml(p.method||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">واریز به حساب</label>
        <select class="form-select" id="ep-account">${financialAccountOptionsHtml(p.account_id)}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="ep-note" value="${escapeHtml(p.note||'')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `savePaymentEdit(${id})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}


async function savePaymentEdit(id) {
  const amountRaw = document.getElementById('ep-amount')?.value?.trim() ?? '';
  const amount = Number(amountRaw);
  const date = document.getElementById('ep-date')?.value;
  if (amountRaw === '' || !Number.isFinite(amount) || amount < 0) { showToast('مبلغ معتبر وارد کنید (صفر مجاز است)', 'error'); return; }
  if (!date) { showToast('تاریخ را وارد کنید', 'error'); return; }
  const payments = await window.api.payments.getAll();
  const p = payments.find(x => x.id === id);
  const pkgValue = document.getElementById('ep-pkg')?.value;
  await window.api.payments.update({
    id, amount, date,
    package_id: pkgValue === '__general__' ? null : +pkgValue,
    currency: document.getElementById('ep-currency')?.value,
    method: document.getElementById('ep-method')?.value,
    account_id: document.getElementById('ep-account')?.value || null,
    note: document.getElementById('ep-note')?.value,
  });
  try { await _syncToServer(); } catch (e) {}
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  if (currentPage === 'payments') await renderPayments();
  else { allStudents = await window.api.students.getAll(); await openStudentDetail(p.student_id); }
}


async function deletePayment(id, context) {
  if (!confirm('این پرداخت حذف شود؟ این عمل قابل بازگشت نیست.')) return;
  const payments = await window.api.payments.getAll();
  const p = payments.find(x => x.id === id);
  await window.api.payments.delete(id);
  showToast('حذف شد', 'error');
  if (context === 'payments') await renderPayments();
  else { allStudents = await window.api.students.getAll(); if (p) await openStudentDetail(p.student_id); }
}

// ── General "add payment" (from Payments page) ────────────────────────────────

async function openGeneralPurchaseModal() {
  allStudents = allStudents.length ? allStudents : await window.api.students.getAll();
  const options = allStudents.filter(s => !s.archived)
    .map(s => `<option value="${s.id}">${escapeHtml(s.name)} ${escapeHtml(s.lname)}</option>`).join('');
  openModal('🛒 افزودن خرید جدید', `
    <div class="form-group full">
      <label class="form-label">${META.entitySingular||'شاگرد'} *</label>
      <select class="form-select" id="gpur-student">${options}</select>
    </div>
    <p style="font-size:11px;color:var(--text3);margin-top:6px">پس از انتخاب، فرم خرید کامل باز می‌شود.</p>
  `, [
    { label: 'ادامه', cls: 'btn-primary', action: 'confirmGeneralPurchaseStudent()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}

function confirmGeneralPurchaseStudent() {
  const id = +document.getElementById('gpur-student')?.value;
  closeModal();
  if (id) openNewPurchase(id);
}


function openGeneralPaymentModal() {
  if (!allStudents.length) { showToast(`ابتدا ${META.entitySingular||'شاگرد'} اضافه کنید`, 'error'); return; }
  const studentOptions = allStudents.map(s => `<option value="${s.id}">${escapeHtml(s.name)} ${escapeHtml(s.lname)}</option>`).join('');

  openModal('افزودن پرداختی', `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">${META.entitySingular||'شاگرد'} *</label>
        <select class="form-select" id="gp-student" onchange="updateGeneralPaymentPkgs()">${studentOptions}</select>
      </div>
      <div class="form-group full" id="gp-pkg-info" style="margin-bottom:-6px"></div>
      <div class="form-group full">
        <label class="form-label">پکیج / خدمت *</label>
        <select class="form-select" id="gp-pkg" onchange="toggleQuickNewPackage('gp')"></select>
      </div>
      ${newPurchaseHintHtml(`document.getElementById('gp-student')?.value`)}
      ${quickNewPackageFieldsHtml('gp')}
      <div class="form-group">
        <label class="form-label">مبلغ دریافتی الان *</label>
        <input class="form-input amount-input" id="gp-amount" type="number" placeholder="0">
      </div>
      <div class="form-group">
        <label class="form-label">واحد پول</label>
        <select class="form-select" id="gp-currency">${currencyOptions()}</select>
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی) *</label>
        <input class="form-input jdate" id="gp-date" placeholder="انتخاب تاریخ" value="${formatJalali(...todayJalali())}">
      </div>
      <div class="form-group">
        <label class="form-label">بابت / شماره پیگیری</label>
        <input class="form-input" id="gp-method" placeholder="مثلاً: قسط دوم، شماره فاکتور...">
      </div>
      <div class="form-group">
        <label class="form-label">واریز به حساب</label>
        <select class="form-select" id="gp-account">${financialAccountOptionsHtml()}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="gp-note" placeholder="مثلاً: پرداخت نقدی امروز">
      </div>
    </div>
  `, [
    { label: 'ثبت پرداخت', cls: 'btn-primary', action: 'saveGeneralPayment()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  updateGeneralPaymentPkgs();
  initDatePickers();
}


function updateGeneralPaymentPkgs() {
  const sid = +document.getElementById('gp-student')?.value;
  const s = allStudents.find(x => x.id === sid);
  const sel = document.getElementById('gp-pkg');
  const opts = paymentPackageOptionsHtml(s?.packages || []);
  sel.innerHTML = opts || '<option value="">— پکیجی ثبت نشده —</option>';
  toggleQuickNewPackage('gp');
  const info = document.getElementById('gp-pkg-info');
  const pkgLabels = uniquePaymentPackageOptions(s?.packages || []).map(p=>p.type_label).join('، ') || '—';
  if (info) info.innerHTML = `<p style="font-size:11px;color:var(--text3)">خدمات فعال: ${pkgLabels} — مانده فعلی: ${balanceHtml(s?.balance||0)}</p>`;
}


async function saveGeneralPayment() {
  const studentId = +document.getElementById('gp-student')?.value;
  const pkgId = document.getElementById('gp-pkg')?.value;
  const amount = +(document.getElementById('gp-amount')?.value || 0);
  const date = document.getElementById('gp-date')?.value;
  if (!pkgId) { showToast('پکیج را انتخاب کنید', 'error'); return; }
  if (!amount || amount <= 0) { showToast('مبلغ دریافتی را وارد کنید', 'error'); return; }
  if (!date) { showToast('تاریخ را وارد کنید', 'error'); return; }

  let packageId = pkgId === '__general__' ? null : +pkgId;
  if (pkgId === '__new__') {
    const newTotal = +(document.getElementById('gp-new-total')?.value || 0) || amount;
    const res = await window.api.packages.add({
      student_id: studentId,
      type_id: +(document.getElementById('gp-new-type')?.value || 0),
      total_amount: newTotal,
      initial_cost: 0,
      current_payment: 0,
      repeat_months: 0,
      note: document.getElementById('gp-note')?.value || '',
      date,
    });
    packageId = +res?.id;
  }

  await window.api.payments.add({
    package_id: packageId,
    student_id: studentId,
    amount,
    currency: document.getElementById('gp-currency')?.value || 'تومان',
    date,
    method: document.getElementById('gp-method')?.value,
    account_id: document.getElementById('gp-account')?.value || null,
    note: document.getElementById('gp-note')?.value,
  });
  try { await _syncToServer(); } catch (e) {}
  closeModal();
  showToast('پرداخت ثبت شد ✓', 'success');
  await renderPayments();
}

// ════════════════════════════════════════════════════════════════════════════
// PAYMENTS PAGE
// ════════════════════════════════════════════════════════════════════════════

function accountCustomerTabsHtml(tab, search = '') {
  return `
    <div class="payments-toolbar account-tabs-toolbar">
      <div class="payments-segmented" role="tablist" aria-label="حساب مشتریان">
        <button class="${tab==='purchases'?'active':''}" role="tab" aria-selected="${tab==='purchases'}" onclick="_tpPaymentsTab('purchases')">🛒 فروش</button>
        <button class="${tab==='payments'?'active':''}" role="tab" aria-selected="${tab==='payments'}" onclick="_tpPaymentsTab('payments')">💳 دریافت</button>
        <button class="${tab==='reminders'?'active':''}" role="tab" aria-selected="${tab==='reminders'}" onclick="_tpPaymentsTab('reminders')">🔔 یادآوری</button>
        <button class="${tab==='families'?'active':''}" role="tab" aria-selected="${tab==='families'}" onclick="_tpPaymentsTab('families')">👤 حساب مشتری</button>
      </div>
    </div>`;
}


function accountCustomerTopbarHtml(tab, search = '') {
  if (tab === 'families') {
    return `<div class="table-search">
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="2"/><path d="M15 15l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <input placeholder="جستجوی مشتری..." oninput="renderPayments(this.value)" value="${escapeHtml(search)}">
  </div>
  <button class="btn btn-primary" onclick="openNewFamily()"><span class="btn-icon">+</span><span> افزودن گروه جدید</span></button>`;
  }
  if (!['purchases', 'payments', 'reminders'].includes(tab)) return '';
  const searchPlaceholder = tab === 'reminders' ? 'جستجوی یادآوری...' : 'جستجو با نام...';
  return `<div class="table-search">
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="2"/><path d="M15 15l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    <input placeholder="${searchPlaceholder}" oninput="renderPayments(this.value)" value="${escapeHtml(search)}">
  </div>`;
}


async function renderPayments(search = '') {
  const tab = _paymentsTab;
  _syncPaymentsListShown(tab, search);

  updateTopbarActions(accountCustomerTopbarHtml(tab, search));

  if (tab === 'payments') {
    await _ensureCompleteBusinessParts(['students', 'payments']);
  } else if (tab === 'purchases') {
    await _ensureCompleteBusinessParts(['students', 'packages']);
  } else if (tab === 'reminders') {
    await _ensureCompleteBusinessParts(['students', 'reminders', 'payments', 'packages']);
    _reconcileOverdueRemindersForSettledCustomers();
  }

  allStudents = await window.api.students.getAll();
  try {
    const remindersForBadge = await window.api.reminders.getAll();
    updateReminderBadges(_pendingPaymentReminderCount(remindersForBadge));
  } catch(e) {}
  const q = search.trim().toLowerCase();

  if (tab === 'families') {
    await renderFamilies(true, search);
    return;
  }

  if (tab === 'purchases') {
    let packages = await window.api.packages.getAll();
    if (q) packages = packages.filter(p => `${p.name} ${p.lname}`.toLowerCase().includes(q));

    let html = `${accountCustomerTabsHtml(tab, search)}<div class="table-card tbl-responsive customer-sales-table">
      <div class="table-header"><span class="title">🛒 تاریخچه کل فروش ها (${fa(packages.length)} مورد)</span><button class="btn btn-primary btn-sm payment-header-add" title="افزودن خرید" onclick="openGeneralPurchaseModal()">+</button></div>
      <table>
        <thead><tr><th>${META.entitySingular||'شاگرد'}</th><th>نوع خرید</th><th>مجری</th><th>مبلغ کل</th><th>شروع / سررسید پرداخت</th><th>تکرار</th><th>توضیحات</th><th>عملیات</th></tr></thead>
        <tbody>`;
    const purchaseSlice = _visiblePaymentsSlice('purchases', packages);
    if (packages.length === 0) {
      html += `<tr><td colspan="8"><div class="empty"><span>🛒</span>خریدی ثبت نشده</div></td></tr>`;
    } else {
      purchaseSlice.rows.forEach(p => {
        const saleMenuId = `sale-menu-${p.id}`;
        html += `<tr>
          <td data-label="مشتری" style="font-weight:500">${escapeHtml(p.name)} ${escapeHtml(p.lname)}</td>
          <td><span class="tag" style="background:${p.pkg_color}22;color:${p.pkg_color}">${escapeHtml(p.type_label)}</span></td>
          <td style="font-size:11px;color:var(--text2)">${escapeHtml(p.staff_name||'—')}</td>
          <td><span class="amount amount-paid">${fmt(p.total_amount)} تومان</span></td>
          <td style="color:var(--text2)">
            <div>شروع: ${DateService.disp(p.start_date)||'—'}</div>
            <div style="font-size:10px;color:${_isPackageChargeable(p)?'var(--green)':'var(--amber)'};margin-top:2px">سررسید پرداخت: ${DateService.disp(p.payment_due_date)||'—'}${_isPackageChargeable(p)?'':' · آینده'}</div>
          </td>
          <td style="font-size:11px;color:var(--text2)">${p.repeat_months>0?`هر ${fa(p.repeat_months)} ماه`:'یک‌بار'}</td>
          <td style="font-size:11px;color:var(--text3)">${escapeHtml(p.note||'')}</td>
          <td data-label="عملیات">
            <div class="row-menu">
              <button class="row-menu-btn" type="button" aria-label="عملیات فروش ${escapeHtml(`${p.name} ${p.lname}`.trim())}" aria-haspopup="menu" onclick="toggleRowMenu(event,'${saleMenuId}')">⋮</button>
              <div class="row-menu-panel" id="${saleMenuId}" role="menu">
                <div class="row-menu-item" role="menuitem" onclick="openEditPackage(${p.id})">✏️ ویرایش فروش</div>
                <div class="row-menu-divider"></div>
                <div class="row-menu-item danger" role="menuitem" onclick="deletePackage(${p.id})">🗑 حذف فروش</div>
              </div>
            </div>
          </td>
        </tr>`;
      });
    }
    html += `</tbody></table>${_paymentsMoreButtonHtml('purchases', purchaseSlice.remaining)}</div>`;
    const packagePaging = _businessPagingState('packages');
    const morePackages = (purchaseSlice.remaining > 0 || packagePaging.done) ? '' :
      '<button class="todo-show-more" onclick="_loadMoreBusiness(\'packages\')">دریافت فروش‌های بیشتر</button>';
    setContent(html + morePackages);

  } else if (tab === 'payments') {
    const allPayments = await window.api.payments.getAll();
    let payments = allPayments;
    if (q) payments = payments.filter(p => `${p.name} ${p.lname}`.toLowerCase().includes(q));
    payments = _sortPaymentsNewestFirst(payments);

    let html = `${accountCustomerTabsHtml(tab, search)}<div class="table-card tbl-responsive customer-payments-table">
      <div class="table-header"><span class="title">💳 تاریخچه دریافت‌ها (${fa(payments.length)} مورد)</span><button class="btn btn-primary btn-sm payment-header-add" title="افزودن دریافت" onclick="openGeneralPaymentModal()">+</button></div>
      <table>
        <thead><tr><th>${META.entitySingular||'شاگرد'}</th><th>پکیج</th><th>مبلغ</th><th>تاریخ</th><th>واریز به حساب</th><th>مانده حساب</th><th>یادداشت</th><th>عملیات</th></tr></thead>
        <tbody>`;
    const paymentSlice = _visiblePaymentsSlice('payments', payments);
    if (payments.length === 0) {
      html += `<tr><td colspan="8"><div class="empty"><span>💳</span>پرداختی ثبت نشده</div></td></tr>`;
    } else {
      paymentSlice.rows.forEach(p => {
        const student = allStudents.find(s => s.id === p.student_id);
        html += `<tr>
          <td data-label="مشتری" style="font-weight:500"><button class="btn btn-ghost btn-sm" style="padding:0;border:0;background:none" onclick="openStudentDetail(${p.student_id})">${escapeHtml(p.name)} ${escapeHtml(p.lname)}</button></td>
          <td data-label="پکیج"><span class="tag" style="background:${p.pkg_color}22;color:${p.pkg_color}">${escapeHtml(p.pkg_label)}</span></td>
          <td data-label="مبلغ"><span class="amount amount-paid">${fmt(p.amount)} ${escapeHtml(p.currency||'تومان')}</span></td>
          <td data-label="تاریخ" style="color:var(--text2)">${DateService.disp(p.date_jalali)}</td>
          <td data-label="واریز به حساب" style="font-size:11px;color:${p.account_label?'var(--accent2)':'var(--text3)'}">${escapeHtml(p.account_label||'ثبت نشده')}</td>
          <td data-label="مانده حساب">${student ? balanceHtml(student.balance) : '—'}</td>
          <td data-label="یادداشت" style="color:var(--text3);font-size:11px">${escapeHtml(p.note||'')}${p.method?` (${escapeHtml(p.method)})`:''}</td>
          <td data-label="عملیات">
            <div class="row-menu">
              <button class="row-menu-btn" type="button" aria-label="عملیات دریافت ${escapeHtml(`${p.name} ${p.lname}`.trim())}" aria-haspopup="menu" onclick="toggleRowMenu(event,'payment-menu-${p.id}')">⋮</button>
              <div class="row-menu-panel" id="payment-menu-${p.id}" role="menu">
                <div class="row-menu-item" role="menuitem" onclick="openEditPayment(${p.id})">✏️ ویرایش دریافت</div>
                <div class="row-menu-divider"></div>
                <div class="row-menu-item danger" role="menuitem" onclick="deletePayment(${p.id}, 'payments')">🗑 حذف دریافت</div>
              </div>
            </div>
          </td>
        </tr>`;
      });
    }
    html += `</tbody></table>${_paymentsMoreButtonHtml('payments', paymentSlice.remaining)}</div>`;
    const paymentPaging = _businessPagingState('payments');
    const morePayments = (paymentSlice.remaining > 0 || paymentPaging.done) ? '' :
      '<button class="todo-show-more" onclick="_loadMoreBusiness(\'payments\')">دریافت دریافت‌های بیشتر</button>';
    setContent(html + morePayments);
  } else {
    await renderReminders(search, true, accountCustomerTabsHtml(tab, search));
  }

  if (search) {
    requestAnimationFrame(() => {
      const sp = document.querySelector('#topbar-actions .table-search input') ||
                 document.querySelector('.table-search input');
      if (sp) { sp.focus(); try { sp.setSelectionRange(search.length, search.length); } catch(e){} }
    });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SESSIONS PAGE
// ════════════════════════════════════════════════════════════════════════════

function familyActionsHtml(familyId) {
  return `<div class="family-actions" data-family-actions="${familyId}">
    <button type="button" class="family-actions-trigger" aria-label="عملیات گروه" aria-haspopup="menu" aria-expanded="false" onclick="toggleFamilyActions(event, ${familyId})">•••</button>
    <div class="family-actions-menu" role="menu" aria-label="عملیات گروه">
      <button role="menuitem" onclick="openFamilyTransactions(${familyId})">📑 تراکنش‌ها</button>
      <button role="menuitem" onclick="openFamilySalesHistory(${familyId})">🛒 تاریخچه فروش به گروه</button>
      <button role="menuitem" onclick="openFamilyPaymentsHistory(${familyId})">💳 تاریخچه دریافت از گروه</button>
      <button role="menuitem" onclick="openAddFamilyMemberById(${familyId})">＋ افزودن عضو</button>
      <button role="menuitem" class="danger" onclick="deleteFamilyById(${familyId})">🗑 حذف گروه</button>
    </div>
  </div>`;
}


function closeFamilyActions() {
  document.querySelectorAll('.family-actions.open').forEach(wrap => {
    wrap.classList.remove('open');
    wrap.querySelector('.family-actions-trigger')?.setAttribute('aria-expanded', 'false');
  });
}


function toggleFamilyActions(event, familyId) {
  event.stopPropagation();
  const wrap = document.querySelector(`[data-family-actions="${familyId}"]`);
  const shouldOpen = wrap && !wrap.classList.contains('open');
  closeFamilyActions();
  if (shouldOpen) {
    wrap.classList.add('open');
    wrap.querySelector('.family-actions-trigger')?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => wrap.querySelector('.family-actions-menu button')?.focus());
  }
}

document.addEventListener('click', event => {
  if (!event.target.closest('.family-actions')) closeFamilyActions();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    const trigger = document.querySelector('.family-actions.open .family-actions-trigger');
    closeFamilyActions();
    trigger?.focus();
  }
});


function familyGroupsSectionHtml(families, search = '') {
  const q = String(search || '').trim().toLowerCase();
  let list = families;
  if (q) {
    list = list.filter(f => String(f.name || '').toLowerCase().includes(q) ||
      (f.members || []).some(m => `${m.name || ''} ${m.lname || ''}`.toLowerCase().includes(q)));
  }
  if (stuChip === 'debt') list = list.filter(f => f.totalBalance > 0);
  else if (stuChip === 'paid') list = list.filter(f => f.totalBalance <= 0);

  if (!families.length) {
    return `<div class="table-card" style="margin-top:16px">
      <div class="table-header"><span class="title">گروه‌های مشترک</span></div>
      <div class="empty"><span>👨‍👩‍👧</span>
        هنوز گروه مشترکی ساخته نشده. اگر چند ${META.entitySingular||'شاگرد'} با هم (مثلاً زن و شوهر) پرداخت می‌کنند، یک گروه بسازید.
        <div style="margin-top:12px"><button class="btn btn-ghost btn-sm" onclick="openNewFamily()">+ افزودن گروه</button></div>
      </div>
    </div>`;
  }
  if (!list.length) {
    return `<div class="table-card" style="margin-top:16px">
      <div class="table-header"><span class="title">گروه‌های مشترک</span></div>
      <div class="empty"><span>🔎</span>گروهی با این فیلتر پیدا نشد</div>
    </div>`;
  }

  let html = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:18px 2px 10px">
    <div style="font-size:13px;font-weight:800;color:var(--text)">گروه‌های مشترک</div>
    <div style="font-size:11px;color:var(--text3)">${fa(list.length)} گروه</div>
  </div>`;
  list.forEach(f => {
    const familyBalanceLabel = f.totalBalance > 0 ? 'بدهی مشترک' : f.totalBalance < 0 ? 'اعتبار مشترک' : 'مانده مشترک';
    html += `
    <div class="table-card family-card tbl-responsive">
      <div class="table-header">
        <span class="title">👨‍👩‍👧 ${escapeHtml(f.name)}</span>
        <span style="margin-right:auto;font-size:12px;font-weight:700">${familyBalanceLabel}: ${familyBalanceHtml(f.totalBalance)}</span>
        ${familyActionsHtml(f.id)}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;padding:10px 12px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.015)">
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:3px">قرارداد کل</div><div style="font-size:13px;font-weight:800;color:var(--text)">${fmt(f.totalAmount)} ت</div></div>
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:3px">پرداخت‌شده کل</div><div style="font-size:13px;font-weight:800;color:var(--green)">${fmt(f.totalPaid)} ت</div></div>
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:3px">کیف پول کل</div><div style="font-size:13px;font-weight:800;color:var(--blue)">${fmt(f.totalWallet)} ت</div></div>
        <div><div style="font-size:10px;color:var(--text3);margin-bottom:3px">${familyBalanceLabel}</div><div style="font-size:13px;font-weight:800">${familyBalanceHtml(f.totalBalance)}</div></div>
      </div>
      <table>
        <thead><tr><th>نام</th><th>پکیج‌ها</th><th>قرارداد کل</th><th>پرداخت‌شده</th><th>کیف پول</th><th>مانده حساب</th><th>وضعیت</th><th>عملیات</th></tr></thead>
        <tbody>
          ${f.members.length === 0
            ? `<tr><td colspan="8"><div class="empty">عضوی ندارد — از ویرایش مشتری، عضو اضافه کن</div></td></tr>`
            : f.members.map(m => `
              <tr>
                <td style="font-weight:500">${escapeHtml(m.name)} ${escapeHtml(m.lname)}</td>
                <td>${pkgTagsHtml(m.packages)}</td>
                <td><span class="amount amount-neutral">${fmt(m.totalAmount)}</span></td>
                <td><span class="amount amount-paid">${fmt(m.totalPaid)}</span></td>
                <td>${m.wallet > 0 ? `<span class="wallet-badge">👛 ${fmt(m.wallet)}</span>` : '<span class="wallet-badge empty">—</span>'}</td>
                <td>${balanceHtml(m.balance)}</td>
                <td>${statusHtml(m.balance)}</td>
                <td>${studentAccountRowMenuHtml(m, `fam-${f.id}-menu-${m.id}`)}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  });
  return html;
}


async function renderFamilies(embedded = currentPage === 'payments', search = '') {
  await _ensureBusinessPartLoaded('students');
  await _ensureBusinessPartLoaded('families');
  const familyPaging = _businessPagingState('families');
  if (!embedded) updateTopbarActions(`<button class="btn btn-primary" onclick="openNewFamily()">+ افزودن گروه جدید</button>`);
  else updateTopbarActions(accountCustomerTopbarHtml('families', search));
  FAMILIES = await window.api.families.getAll();
  allStudents = await window.api.students.getAll();
  { const _sb = document.getElementById('student-badge'); if (_sb) { _sb.textContent = fa(allStudents.length); _sb.style.display = allStudents.length ? '' : 'none'; } }
  const prefix = embedded ? accountCustomerTabsHtml('families') : '';
  const filtered = filterAccountStudents(allStudents, search);
  if (embedded) _syncPaymentsListShown('families', search);
  const familySlice = embedded ? _visiblePaymentsSlice('families', filtered) : null;
  const html = `${prefix}
  ${studentAccountOverviewHtml(allStudents, filtered, {
    showSessions: false,
    menuPrefix: 'acct',
    ...(familySlice ? { slice: familySlice, moreButtonHtml: _paymentsMoreButtonHtml('families', familySlice.remaining) } : {}),
  })}
  ${familyGroupsSectionHtml(FAMILIES, search)}`;
  setContent(html + (familyPaging.done ? '' :
    '<button class="todo-show-more" onclick="_loadMoreBusiness(\'families\')">دریافت گروه‌های بیشتر</button>'));
}


function openNewFamily() {
  const membersChecklist = allStudents.map(x => `
    <label class="pkg-check" for="fam-new-member-${x.id}" style="width:100%;justify-content:flex-start">
      <input type="checkbox" id="fam-new-member-${x.id}" class="fam-member-cb" value="${x.id}" onchange="this.closest('.pkg-check')?.classList.toggle('checked', this.checked)"> ${escapeHtml(`${x.name} ${x.lname}`.trim())}
    </label>`).join('');

  openModal('افزودن گروه جدید', `
    <div class="form-group full">
      <label class="form-label">نام گروه *</label>
      <input class="form-input" id="f-fam-name" placeholder="مثلاً: خانواده محمدی">
    </div>
    <div class="form-section">اعضای گروه</div>
    <div class="pkg-row" style="flex-direction:column;align-items:stretch">${membersChecklist || '<span style="color:var(--text3);font-size:12px">موردی ثبت نشده</span>'}</div>
  `, [
    { label: 'ایجاد', cls: 'btn-primary', action: 'saveNewFamily()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  setTimeout(() => document.getElementById('f-fam-name')?.focus(), 50);
}


async function saveNewFamily() {
  const name = document.getElementById('f-fam-name')?.value.trim();
  if (!name) { showToast('نام گروه را وارد کنید', 'error'); return; }
  const memberIds = [...document.querySelectorAll('.fam-member-cb:checked')].map(cb => +cb.value);
  await window.api.families.add({ name, member_ids: memberIds });
  closeModal();
  showToast('گروه ایجاد شد ✓', 'success');
  await renderFamilies(currentPage === 'payments', currentStudentAccountSearch());
}


async function deleteFamily(id, name) {
  if (!confirm(`آیا مطمئن هستی به حذف حساب مشترک "${name}" یا خیر؟ (اعضا حذف نمی‌شوند، فقط اتصال‌شان قطع می‌شود)`)) return;
  await window.api.families.delete(id);
  showToast('گروه حذف شد', 'error');
  await renderFamilies(currentPage === 'payments', currentStudentAccountSearch());
}


function openAddFamilyMember(familyId, familyName) {
  allStudents = allStudents.length ? allStudents : [];
  const fam = FAMILIES.find(f => f.id === familyId);
  const memberIds = new Set((fam?.members || []).map(m => m.id));
  const candidates = allStudents.filter(s => !memberIds.has(s.id));

  if (candidates.length === 0) {
    showToast(`همه ${META.entityPlural||'شاگردان'} ثبت‌شده عضو این گروه هستند`, '');
    return;
  }

  const list = candidates.map(s => `
    <label class="pkg-check" style="width:100%;justify-content:flex-start" onclick="this.classList.toggle('checked')">
      <input type="checkbox" class="fam-add-cb" value="${s.id}"> ${escapeHtml(s.name)} ${escapeHtml(s.lname)}
    </label>`).join('');

  openModal(`افزودن عضو به "${escapeHtml(familyName)}"`, `
    <div class="pkg-row" style="flex-direction:column;align-items:stretch">${list}</div>
  `, [
    { label: 'افزودن', cls: 'btn-primary', action: `saveAddFamilyMembers(${familyId}, ${escapeAttr(familyName)})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}


async function saveAddFamilyMembers(familyId, familyName) {
  const ids = [...document.querySelectorAll('.fam-add-cb:checked')].map(cb => +cb.value);
  if (ids.length === 0) { showToast('کسی را انتخاب نکردی', 'error'); return; }
  for (const id of ids) {
    await window.api.students.setFamily({ id, family_id: familyId });
  }
  closeModal();
  showToast('اضافه شد ✓', 'success');
  allStudents = await window.api.students.getAll();
  await renderFamilies(currentPage === 'payments', currentStudentAccountSearch());
}

// ════════════════════════════════════════════════════════════════════════════
// REMINDERS PAGE
// ════════════════════════════════════════════════════════════════════════════

async function renderReminders(search = '', embedded = false, contentPrefix = '') {
  _syncPaymentsListShown('reminders', search);
  if (!embedded) {
    updateTopbarActions(`
      <div class="payments-toolbar">
        <div class="payments-segmented" role="tablist" aria-label="تاریخچه مالی">
          <button role="tab" onclick="_tpPaymentsTab('purchases',1)">🛒 فروش</button>
          <button role="tab" onclick="_tpPaymentsTab('payments',1)">💳 دریافت</button>
          <button class="active" role="tab" aria-selected="true">🔔 یادآوری</button>
        </div>
        <div class="table-search">
          <span style="color:var(--text3)">🔍</span>
          <input placeholder="جستجوی یادآوری..." oninput="renderReminders(this.value)" value="${escapeHtml(search)}">
        </div>
      </div>
    `);
  }
  await _ensureCompleteBusinessParts(['students', 'reminders', 'payments', 'packages']);
  _reconcileOverdueRemindersForSettledCustomers();
  try{_runAutomationScans();}catch(e){}
  const reminderPaging = _businessPagingState('reminders');
  allStudents = await window.api.students.getAll();
  const reminders = (await window.api.reminders.getAll()).filter(_isPaymentReminder);
  const today = jalaliKey(formatJalali(...todayJalali()));

  updateReminderBadges(_pendingPaymentReminderCount(reminders));

  if (reminders.length === 0) {
    setContent(`${contentPrefix}<div class="detail-section" style="margin-bottom:12px;border-color:rgba(124,106,247,.28)">
      <h3 style="margin-bottom:6px">چرخه فروش، دریافت و یادآوری</h3>
      <p style="font-size:12px;color:var(--text2);line-height:1.8;margin:0">
        فروش دوره‌ای را در بخش فروش ثبت کن؛ TeamPulse بر اساس سررسید اولین پرداخت و دوره تکرار، یادآوری پرداخت را خودش می‌سازد. یادآوری دستی فقط برای مواردی است که فروش مشخصی پشتش نیست.
      </p>
    </div><div class="table-card">
      <div class="table-header"><span class="title">🔔 یادآوری‌ها</span><button class="btn btn-primary btn-sm payment-header-add" title="افزودن یادآوری" onclick="openAddReminder()">+</button></div>
      <div class="empty"><span>⏰</span>
        یادآوری‌ای ثبت نشده. با ثبت فروش دوره‌ای، یادآوری پرداخت به‌صورت خودکار اینجا ساخته می‌شود.
      </div>
    </div>`);
    return;
  }

  const filtered = (search
    ? reminders.filter(r => (r.name + r.lname + r.title + (r.note || '')).toLowerCase().includes(search.toLowerCase()))
    : reminders).filter(r => {
      if (r.done) return true;
      const student = allStudents.find(s => String(s.id) === String(r.student_id));
      if (!student) return true;
      const due = jalaliKey(r.due_date_jalali);
      return !(Number(student.balance || 0) <= 0 && due && due <= today);
    });

  let html = `${contentPrefix}<div class="detail-section" style="margin-bottom:12px;border-color:rgba(124,106,247,.28)">
    <h3 style="margin-bottom:6px">چرخه فروش، دریافت و یادآوری</h3>
    <p style="font-size:12px;color:var(--text2);line-height:1.8;margin:0">
      فروش دوره‌ای را در بخش فروش ثبت کن؛ TeamPulse بر اساس سررسید اولین پرداخت و دوره تکرار، یادآوری پرداخت را خودش می‌سازد. وقتی از همین صفحه پرداخت را تأیید کنی، دریافت ثبت می‌شود و سررسید بعدی هم خودکار جلو می‌رود.
    </p>
  </div><div class="table-card tbl-responsive customer-reminders-table">
    <div class="table-header"><span class="title">🔔 یادآوری‌ها (${fa(filtered.length)} مورد)</span><button class="btn btn-primary btn-sm payment-header-add" title="افزودن یادآوری" onclick="openAddReminder()">+</button></div>
    <table>
      <thead><tr><th>${META.entitySingular||'شاگرد'}</th><th>عنوان</th><th>سررسید</th><th>مبلغ</th><th>تکرار</th><th>وضعیت</th><th>عملیات</th></tr></thead>
      <tbody>`;

  if (filtered.length === 0) {
    html += `<tr><td colspan="7"><div class="empty"><span>🔍</span>چیزی پیدا نشد</div></td></tr>`;
  }

  const reminderSlice = _visiblePaymentsSlice('reminders', filtered);
  reminderSlice.rows.forEach(r => {
    const due = jalaliKey(r.due_date_jalali);
    const reminderMenuId = `reminder-menu-${r.id}`;
    let statusBadge;
    if (r.done) statusBadge = `<span class="status status-ok">پرداخت شد</span>`;
    else if (due < today) statusBadge = `<span class="status status-debt">سررسید گذشته</span>`;
    else if (due === today) statusBadge = `<span class="status" style="color:var(--amber)"><span style="width:7px;height:7px;border-radius:50%;background:var(--amber);display:inline-block;margin-left:5px"></span>امروز</span>`;
    else if (r.days_until !== undefined && r.days_until <= 3) statusBadge = `<span class="status" style="color:var(--blue)"><span style="width:7px;height:7px;border-radius:50%;background:var(--blue);display:inline-block;margin-left:5px"></span>آینده (فقط ${fa(r.days_until)} روز مانده)</span>`;
    else {
      const months = Math.floor(r.days_until / 30);
      const remDays = r.days_until % 30;
      let remainText;
      if (months > 0 && remDays > 0) remainText = `${fa(months)} ماه و ${fa(remDays)} روز مانده`;
      else if (months > 0) remainText = `${fa(months)} ماه مانده`;
      else remainText = `${fa(remDays)} روز مانده`;
      statusBadge = `<span class="status" style="color:var(--green)"><span style="width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;margin-left:5px"></span>آینده (هنوز نرسیده — ${remainText})</span>`;
    }

    html += `<tr>
      <td data-label="مشتری" style="font-weight:500">${escapeHtml(r.name)} ${escapeHtml(r.lname)}</td>
      <td data-label="عنوان">${escapeHtml(r.title)}${r.note ? `<div style="font-size:11px;color:var(--text3)">${escapeHtml(r.note)}</div>`:''}</td>
      <td data-label="سررسید">
        <div>${DateService.disp(r.due_date_jalali)}</div>
      </td>
      <td data-label="مبلغ">${r.amount ? fmt(r.amount) + ' ت' : '—'}</td>
      <td data-label="تکرار" style="color:var(--text2);font-size:11px">${r.repeat_months > 0 ? `هر ${fa(r.repeat_months)} ماه` : 'یک‌بار'}</td>
      <td data-label="وضعیت">${statusBadge}</td>
      <td data-label="عملیات">
        <div class="row-menu">
          <button class="row-menu-btn" onclick="toggleRowMenu(event,'${reminderMenuId}')" aria-label="عملیات یادآوری">⋮</button>
          <div class="row-menu-panel" id="${reminderMenuId}">
            ${!r.done ? `<div class="row-menu-item" onclick="markReminderPaid(${r.id})">✓ پرداخت شد</div>` : ''}
            ${!r.done && r.amount ? `<div class="row-menu-item" onclick="openBalePaymentRequest({student_id:${r.student_id},reminder_id:${r.id},package_id:${r.package_id==null?'null':JSON.stringify(r.package_id)},amount:${Math.round(Number(r.amount)||0)},title:${JSON.stringify(String(r.title||'سررسید پرداخت').slice(0,32))}})">بله‌پی</div>` : ''}
            ${!r.done ? `<div class="row-menu-item" onclick="openPurchaseFromReminder(${r.id})">🛒 خرید جدید</div>` : ''}
            <div class="row-menu-item" onclick="openEditReminder(${r.id})">✏️ ویرایش</div>
            <div class="row-menu-divider"></div>
            <div class="row-menu-item danger" onclick="deleteReminder(${r.id})">🗑 حذف</div>
          </div>
        </div>
      </td>
    </tr>`;
  });

  html += `</tbody></table>${_paymentsMoreButtonHtml('reminders', reminderSlice.remaining)}</div>`;
  setContent(html + ((reminderSlice.remaining > 0 || reminderPaging.done) ? '' :
    '<button class="todo-show-more" onclick="_loadMoreBusiness(\'reminders\')">دریافت یادآوری‌های بیشتر</button>'));
}


function openAddReminder(presetStudentId = null) {
  if (!allStudents.length) { showToast(`ابتدا ${META.entitySingular||'شاگرد'} اضافه کنید`, 'error'); return; }
  const opts = allStudents.map(s => `<option value="${s.id}" ${s.id===presetStudentId?'selected':''}>${escapeHtml(s.name)} ${escapeHtml(s.lname)}</option>`).join('');

  openModal('یادآوری پرداخت جدید', `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">${META.entitySingular||'شاگرد'} *</label>
        <select class="form-select" id="r-student">${opts}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="r-title" placeholder="مثلاً: تجدید کوچینگ ۶ ماهه">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ سررسید (شمسی) *</label>
        <input class="form-input jdate" id="r-date" placeholder="انتخاب تاریخ">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ مورد انتظار (تومان)</label>
        <input class="form-input amount-input" id="r-amount" type="number" placeholder="0">
      </div>
      <div class="form-group full">
        <label class="form-label">تکرار</label>
        <select class="form-select" id="r-repeat">
          <option value="0">بدون تکرار (یک‌بار)</option>
          <option value="1">هر ۱ ماه</option>
          <option value="3">هر ۳ ماه</option>
          <option value="6" selected>هر ۶ ماه</option>
          <option value="12">هر ۱۲ ماه</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="r-note" placeholder="اختیاری">
      </div>
    </div>
  `, [
    { label: 'ثبت یادآوری', cls: 'btn-primary', action: 'saveReminder()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}


async function saveReminder() {
  const studentId = +document.getElementById('r-student')?.value;
  const due = document.getElementById('r-date')?.value;
  if (!due) { showToast('تاریخ سررسید را وارد کنید', 'error'); return; }
  await window.api.reminders.add({
    student_id: studentId,
    title: document.getElementById('r-title')?.value || 'یادآوری پرداخت',
    due_date: due,
    amount: +(document.getElementById('r-amount')?.value || 0),
    repeat_months: +(document.getElementById('r-repeat')?.value || 0),
    note: document.getElementById('r-note')?.value || '',
  });
  closeModal();
  showToast('یادآوری ثبت شد ✓', 'success');
  await refreshReminderSurface();
}


async function markReminderPaid(id) {
  const reminders = await window.api.reminders.getAll();
  const r = reminders.find(x => x.id === id);
  if (!r) return;

  openModal('تأیید پرداخت', `
    <p style="font-size:13px;margin-bottom:12px">آیا پرداخت "<b>${escapeHtml(r.title)}</b>" برای <b>${escapeHtml(r.name)} ${escapeHtml(r.lname)}</b> انجام شده؟</p>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">مبلغ دریافتی (تومان)</label>
        <input class="form-input amount-input" id="rp-amount" type="number" value="${r.amount || 0}">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ دریافت (شمسی)</label>
        <input class="form-input jdate" id="rp-date" value="${formatJalali(...todayJalali())}">
      </div>
    </div>
    <label class="pkg-check checked" style="width:100%;margin-top:8px" onclick="this.classList.toggle('checked')">
      <input type="checkbox" id="rp-record" checked> این مبلغ را به‌عنوان پرداخت در سیستم ثبت کن
    </label>
    ${r.repeat_months > 0 ? `<p style="font-size:11px;color:var(--text3);margin-top:8px">این یادآوری تکرارشونده است؛ بعد از تأیید، سررسید بعدی به‌صورت خودکار ${fa(r.repeat_months)} ماه بعد تنظیم می‌شود.</p>` : ''}
  `, [
    { label: 'تأیید', cls: 'btn-primary', action: `confirmReminderPaid(${id})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}


async function confirmReminderPaid(id) {
  const record = document.querySelector('#rp-record')?.checked;
  const amount = +(document.getElementById('rp-amount')?.value || 0);
  const date = document.getElementById('rp-date')?.value;
  await window.api.reminders.markPaid({ id, record_payment: record, amount, date });
  closeModal();
  showToast('ثبت شد ✓', 'success');
  await refreshReminderSurface();
}


async function _ensurePackageTypeByLabel(label) {
  const clean = (label || '').trim() || 'خرید جدید';
  PKG_TYPES = PKG_TYPES.length ? PKG_TYPES : await window.api.packageTypes.getAll();
  let pt = PKG_TYPES.find(x => String(x.label || '').trim() === clean);
  if (!pt) {
    await window.api.packageTypes.add({ label: clean, color: '#7c6af7' });
    PKG_TYPES = await window.api.packageTypes.getAll();
    pt = PKG_TYPES.find(x => String(x.label || '').trim() === clean);
  }
  return pt;
}


async function openPurchaseFromReminder(id) {
  const reminders = await window.api.reminders.getAll();
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  allStudents = allStudents.length ? allStudents : await window.api.students.getAll();
  const pt = await _ensurePackageTypeByLabel(r.title);
  openNewPurchase(r.student_id, {
    reminder_id: r.id,
    type_id: pt?.id,
    amount: r.amount || 0,
    repeat_months: r.repeat_months || 0,
    date: formatJalali(...todayJalali()),
    payment_due_date: r.due_date_jalali,
    note: r.note || `از یادآوری پرداخت: ${r.title || ''}`,
  });
}


function openAddFamilyMemberById(familyId) {
  closeFamilyActions();
  const family = FAMILIES.find(f => f.id === familyId);
  if (family) openAddFamilyMember(family.id, family.name);
}


function deleteFamilyById(familyId) {
  closeFamilyActions();
  const family = FAMILIES.find(f => f.id === familyId);
  if (family) deleteFamily(family.id, family.name);
}


async function getFamilyFinancialHistory(familyId) {
  const family = FAMILIES.find(f => f.id === familyId);
  if (!family) return null;
  const members = family.members || [];
  const memberById = new Map(members.map(m => [m.id, m]));
  const [salesByMember, paymentsByMember] = await Promise.all([
    Promise.all(members.map(m => window.api.packages.getByStudent(m.id))),
    Promise.all(members.map(m => window.api.payments.getByStudent(m.id))),
  ]);
  const sales = salesByMember.flat().map(p => ({...p, member: memberById.get(p.student_id)}))
    .sort((a,b) => jalaliKey(b.start_date || '') - jalaliKey(a.start_date || '') || b.id - a.id);
  const payments = paymentsByMember.flat().map(p => ({...p, member: memberById.get(p.student_id)}))
    .sort((a,b) => jalaliKey(b.date_jalali || '') - jalaliKey(a.date_jalali || '') || b.id - a.id);
  return {family, sales, payments};
}


function _partyTxSortKey(date, createdAt, id) {
  return [jalaliKey(date || '') || 0, Date.parse(createdAt || '') || 0, Number(id) || 0];
}


function _buildPartyTxItems(payload) {
  const items = [];
  (payload.sales || []).forEach(p => {
    const amount = Number(p.total_amount || 0) + Number(p.initial_cost || 0);
    items.push({
      kind: 'purchase',
      date: p.start_date || '',
      created_at: p.created_at || '',
      id: p.id,
      memberName: `${p.member?.name || p.name || ''} ${p.member?.lname || p.lname || ''}`.trim(),
      title: p.type_label || 'خرید',
      note: p.note || '',
      debit: amount,
      credit: 0,
      currency: 'تومان',
      affectsBalance: true,
    });
  });
  (payload.payments || []).forEach(p => {
    const currency = p.currency || 'تومان';
    items.push({
      kind: 'payment',
      date: p.date_jalali || '',
      created_at: p.created_at || '',
      id: p.id,
      memberName: `${p.member?.name || p.name || ''} ${p.member?.lname || p.lname || ''}`.trim(),
      title: [p.pkg_label, p.method, p.account_label].filter(Boolean).join(' · ') || 'دریافت',
      note: p.note || '',
      debit: 0,
      credit: Number(p.amount || 0),
      currency,
      affectsBalance: currency === 'تومان',
    });
  });
  items.sort((a, b) => {
    const ka = _partyTxSortKey(a.date, a.created_at, a.id);
    const kb = _partyTxSortKey(b.date, b.created_at, b.id);
    if (ka[0] !== kb[0]) return ka[0] - kb[0];
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    if (a.kind !== b.kind) return a.kind === 'purchase' ? -1 : 1;
    return ka[2] - kb[2];
  });
  let running = 0;
  items.forEach(it => {
    if (it.kind === 'purchase' && it.affectsBalance) running += it.debit;
    else if (it.kind === 'payment' && it.affectsBalance) running -= it.credit;
    it.running = running;
  });
  return items;
}


function _partyTxRowsHtml(view) {
  const showMember = !!view.isGroup;
  const cols = showMember ? 7 : 6;
  if (!(view.items || []).length) {
    return `<tr><td colspan="${cols}" class="tx-invoice-empty">خرید یا پرداختی ثبت نشده</td></tr>`;
  }
  return view.items.map(it => {
    const kind = it.kind === 'purchase' ? 'خرید' : 'دریافت';
    const debit = it.debit ? fmt(it.debit) : '—';
    const credit = it.credit
      ? `${fmt(it.credit)}${it.currency && it.currency !== 'تومان' ? ' ' + escapeHtml(it.currency) : ''}`
      : '—';
    const desc = [it.title, it.note].filter(Boolean).map(escapeHtml).join(' — ');
    return `<tr>
      <td>${DateService.disp(it.date) || '—'}</td>
      ${showMember ? `<td>${escapeHtml(it.memberName || '—')}</td>` : ''}
      <td><span class="tx-kind ${it.kind === 'purchase' ? 'buy' : 'pay'}">${kind}</span></td>
      <td>${desc || '—'}</td>
      <td class="tx-debit">${debit}</td>
      <td class="tx-credit">${credit}</td>
      <td>${it.affectsBalance ? fmt(it.running) : '—'}</td>
    </tr>`;
  }).join('');
}


function _partyTxModalHtml(view) {
  const showMember = !!view.isGroup;
  const balanceLabel = view.balance > 0 ? 'مانده بدهی' : view.balance < 0 ? 'اعتبار' : 'مانده حساب';
  const groupLink = view.familyId
    ? `<button type="button" class="btn btn-ghost btn-sm" onclick="closeModal();openFamilyTransactions(${view.familyId})">صورتحساب گروه «${escapeHtml(view.familyName || '')}»</button>`
    : '';
  return `
    <div class="tx-invoice" id="tx-invoice-sheet">
      <div class="tx-invoice-head">
        <div>
          <div class="tx-invoice-brand">${escapeHtml(view.brand)}</div>
          <div class="tx-invoice-kicker">صورتحساب خرید و دریافت</div>
        </div>
        <div class="tx-invoice-issued">تاریخ صدور: ${DateService.disp(view.issued) || view.issued}</div>
      </div>
      <div class="tx-invoice-party">
        <div class="tx-invoice-party-name">${escapeHtml(view.partyName)}</div>
        ${view.partySub ? `<div class="tx-invoice-party-sub">${escapeHtml(view.partySub)}</div>` : ''}
        ${groupLink}
      </div>
      <div class="tx-invoice-stats">
        <div class="tx-invoice-stat"><div class="k">جمع خرید</div><div class="v">${fmt(view.totalAmount)} ت</div></div>
        <div class="tx-invoice-stat"><div class="k">جمع دریافت</div><div class="v" style="color:var(--green)">${fmt(view.totalPaid)} ت</div></div>
        <div class="tx-invoice-stat"><div class="k">کیف پول</div><div class="v">${fmt(view.wallet)} ت</div></div>
        <div class="tx-invoice-stat"><div class="k">${balanceLabel}</div><div class="v">${view.isGroup ? familyBalanceHtml(view.balance) : balanceHtml(view.balance)}</div></div>
      </div>
      <div class="tx-invoice-table">
        <table>
          <thead><tr>
            <th>تاریخ</th>
            ${showMember ? '<th>عضو</th>' : ''}
            <th>نوع</th>
            <th>شرح</th>
            <th>بدهکار</th>
            <th>بستانکار</th>
            <th>مانده</th>
          </tr></thead>
          <tbody>${_partyTxRowsHtml(view)}</tbody>
        </table>
      </div>
      <div class="tx-invoice-foot">مانده نهایی پس از کسر کیف پول: <strong>${view.isGroup ? familyBalanceHtml(view.balance) : balanceHtml(view.balance)}</strong></div>
    </div>`;
}


function _partyTxDocumentHtml(view, autoPrint) {
  const showMember = !!view.isGroup;
  const printScript = autoPrint ? '<' + 'script>window.onload=()=>{window.focus();setTimeout(()=>window.print(),300);</' + 'script>' : '';
  const balanceLabel = view.balance > 0 ? 'مانده بدهی' : view.balance < 0 ? 'اعتبار' : 'مانده حساب';
  const balanceText = `${view.balance > 0 ? '' : view.balance < 0 ? 'اعتبار ' : ''}${fmt(Math.abs(view.balance))} تومان`;
  const rows = _partyTxRowsHtml(view)
    .replaceAll('class="tx-kind buy"', 'style="color:#111827;font-weight:700"')
    .replaceAll('class="tx-kind pay"', 'style="color:#059669;font-weight:700"')
    .replaceAll('class="tx-debit"', 'style="color:#b91c1c;white-space:nowrap"')
    .replaceAll('class="tx-credit"', 'style="color:#059669;white-space:nowrap"')
    .replaceAll('class="tx-invoice-empty"', 'style="text-align:center;color:#6b7280;padding:28px 10px"');
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(view.title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{direction:rtl;font-family:Tahoma,Arial,sans-serif;color:#1f2937;background:#fff;max-width:860px;margin:0 auto;padding:28px 32px;font-size:12px;line-height:1.8}
.brand{font-size:18px;font-weight:800;color:#111827}
.kicker{font-size:11px;color:#6b7280;margin-top:2px}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding-bottom:14px;border-bottom:2px solid #111827;margin-bottom:16px}
.issued{font-size:11px;color:#4b5563}
.party{margin-bottom:16px}
.party-name{font-size:16px;font-weight:800}
.party-sub{font-size:11px;color:#6b7280;margin-top:2px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin-bottom:16px}
.stat{border:1px solid #e5e7eb;border-radius:8px;padding:8px 10px}
.stat .k{font-size:10px;color:#6b7280}
.stat .v{font-size:13px;font-weight:800;margin-top:2px}
table{width:100%;border-collapse:collapse}
th,td{padding:7px 8px;border-bottom:1px solid #e5e7eb;text-align:right;vertical-align:top}
th{background:#f3f4f6;font-size:11px;color:#4b5563;border-bottom:1px solid #d1d5db}
.foot{margin-top:16px;padding-top:12px;border-top:2px solid #111827;display:flex;justify-content:space-between;font-size:13px}
.sign{margin-top:36px;display:flex;justify-content:space-between;gap:24px}
.sign div{flex:1;text-align:center;font-size:11px;color:#6b7280}
.sign span{display:block;margin-top:40px;border-top:1px dashed #d1d5db;padding-top:6px}
@page{size:A4;margin:14mm}
@media print{body{max-width:none;padding:0}}
</style></head><body>
<div class="head"><div><div class="brand">${escapeHtml(view.brand)}</div><div class="kicker">صورتحساب خرید و دریافت</div></div><div class="issued">تاریخ صدور: ${DateService.disp(view.issued) || escapeHtml(view.issued || '')}</div></div>
<div class="party"><div class="party-name">${escapeHtml(view.partyName)}</div>${view.partySub ? `<div class="party-sub">${escapeHtml(view.partySub)}</div>` : ''}</div>
<div class="stats">
  ${Number(view.wallet || 0) ? `<div class="stat"><div class="k">کیف پول</div><div class="v">${fmt(view.wallet)} تومان</div></div>` : ''}
  <div class="stat"><div class="k">${balanceLabel}</div><div class="v">${balanceText}</div></div>
</div>
<table><thead><tr><th>تاریخ</th>${showMember ? '<th>عضو</th>' : ''}<th>نوع</th><th>شرح</th><th>بدهکار</th><th>بستانکار</th><th>مانده</th></tr></thead><tbody>${rows}</tbody></table>
<div class="foot"><span>مانده نهایی پس از کسر کیف پول</span><strong>${balanceText}</strong></div>
<div class="sign"><div>مهر و امضای صادرکننده<span></span></div><div>رسید مشتری<span></span></div></div>
${printScript}</body></html>`;
}


function _openPartyTransactions(payload) {
  const items = _buildPartyTxItems(payload);
  const view = {
    ...payload,
    items,
    issued: formatJalali(...todayJalali()),
    brand: (META && META.appTitle) || 'TeamPulse',
  };
  window._partyTxPrintPayload = view;
  openModal('📑 تراکنش‌ها', _partyTxModalHtml(view), [
    { label: '🖨 چاپ فاکتور', cls: 'btn-primary', action: 'printPartyTransactions()' },
    { label: '↗ اشتراک لینک', cls: 'btn-ghost', action: 'sharePartyTransactionsLink()' },
    { label: '⬇ دانلود', cls: 'btn-ghost', action: 'downloadPartyTransactions()' },
    { label: '📋 کپی', cls: 'btn-ghost', action: 'copyPartyTransactions()' },
    { label: 'بستن', cls: 'btn-ghost', action: 'closeModal()' },
  ], { overlayClass: 'tx-invoice-overlay' });
}


function _partyTxFilename(view) {
  return String(view?.title || 'صورتحساب').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 70) || 'صورتحساب';
}


function _partyTxPlainText(view) {
  const showMember = !!view.isGroup;
  const balanceLabel = view.balance > 0 ? 'مانده بدهی' : view.balance < 0 ? 'اعتبار' : 'مانده حساب';
  const balanceText = `${view.balance < 0 ? 'اعتبار ' : ''}${fmt(Math.abs(view.balance))} تومان`;
  const lines = [
    view.brand,
    'صورتحساب خرید و دریافت',
    view.partyName,
    view.partySub,
    `تاریخ صدور: ${DateService.disp(view.issued) || view.issued || ''}`,
    '',
  ];
  (view.items || []).forEach(it => {
    const kind = it.kind === 'purchase' ? 'خرید' : 'دریافت';
    const amount = it.kind === 'purchase'
      ? fmt(it.debit)
      : `${fmt(it.credit)}${it.currency && it.currency !== 'تومان' ? ' ' + it.currency : ''}`;
    const desc = [it.title, it.note].filter(Boolean).join(' — ');
    const member = showMember && it.memberName ? ` · ${it.memberName}` : '';
    lines.push(`${DateService.disp(it.date) || '—'} · ${kind}${member} · ${desc || '—'} · ${amount} · مانده ${it.affectsBalance ? fmt(it.running) : '—'}`);
  });
  if (!(view.items || []).length) lines.push('خرید یا پرداختی ثبت نشده');
  if (Number(view.wallet || 0)) lines.push(`کیف پول: ${fmt(view.wallet)} تومان`);
  lines.push(`${balanceLabel}: ${balanceText}`);
  return lines.filter(line => line !== undefined && line !== null).join('\n');
}


function printPartyTransactions() {
  const view = window._partyTxPrintPayload;
  if (!view) { showToast('صورتحساب آماده چاپ نیست', 'error'); return; }
  const popup = window.open('', '_blank', 'width=900,height=760');
  if (!popup) { showToast('مرورگر اجازه بازکردن پنجره پرینت را نداد', 'error'); return; }
  popup.document.open();
  popup.document.write(_partyTxDocumentHtml(view, true));
  popup.document.close();
}


function downloadPartyTransactions() {
  const view = window._partyTxPrintPayload;
  if (!view) { showToast('صورتحساب آماده دانلود نیست', 'error'); return; }
  const blob = new Blob(['\ufeff' + _partyTxDocumentHtml(view, false)], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = _partyTxFilename(view) + '.doc';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast('فایل صورتحساب آماده دانلود شد ✓', 'success');
}


function copyPartyTransactions() {
  const view = window._partyTxPrintPayload;
  if (!view) { showToast('صورتحساب آماده کپی نیست', 'error'); return; }
  copyToClipboard(_partyTxPlainText(view), 'متن صورتحساب کپی شد ✓');
}


async function openStudentTransactions(studentId) {
  if (!allStudents.length) allStudents = await window.api.students.getAll();
  if (!FAMILIES.length) FAMILIES = await window.api.families.getAll();
  const s = allStudents.find(x => x.id === studentId);
  if (!s) return showToast('مشتری پیدا نشد', 'error');
  const fam = FAMILIES.find(f => f.id === s.family_id);
  const [sales, payments] = await Promise.all([
    window.api.packages.getByStudent(studentId),
    window.api.payments.getByStudent(studentId),
  ]);
  const member = { id: s.id, name: s.name, lname: s.lname };
  _openPartyTransactions({
    title: `صورتحساب ${s.name} ${s.lname}`.trim(),
    partyName: `${s.name} ${s.lname}`.trim(),
    partySub: [s.phone, s.organization_name].filter(Boolean).join(' · '),
    isGroup: false,
    familyId: fam ? fam.id : null,
    familyName: fam ? fam.name : '',
    sales: sales.map(p => ({ ...p, member })),
    payments: payments.map(p => ({ ...p, member })),
    totalAmount: s.totalAmount,
    totalPaid: s.totalPaid,
    wallet: s.wallet || 0,
    balance: s.balance,
  });
}


async function openFamilyTransactions(familyId) {
  closeFamilyActions();
  const data = await getFamilyFinancialHistory(familyId);
  if (!data) return showToast('گروه پیدا نشد', 'error');
  const f = data.family;
  _openPartyTransactions({
    title: `صورتحساب گروه ${f.name}`,
    partyName: f.name,
    partySub: (f.members || []).map(m => `${m.name} ${m.lname}`.trim()).join('، '),
    isGroup: true,
    familyId: null,
    sales: data.sales,
    payments: data.payments,
    totalAmount: f.totalAmount,
    totalPaid: f.totalPaid,
    wallet: f.totalWallet,
    balance: f.totalBalance,
  });
}


async function openFamilySalesHistory(familyId) {
  closeFamilyActions();
  const data = await getFamilyFinancialHistory(familyId);
  if (!data) return showToast('گروه پیدا نشد', 'error');
  const total = data.sales.reduce((sum, p) => sum + Number(p.total_amount || 0), 0);
  const rows = data.sales.length ? data.sales.map(p => `<tr>
    <td>${escapeHtml(`${p.member?.name || ''} ${p.member?.lname || ''}`.trim())}</td>
    <td><span class="tag" style="background:${p.pkg_color}22;color:${p.pkg_color}">${escapeHtml(p.type_label || '—')}</span></td>
    <td><span class="amount amount-paid">${fmt(p.total_amount)} تومان</span></td>
    <td>${DateService.disp(p.start_date) || '—'}</td>
    <td style="color:var(--text3);font-size:11px">${escapeHtml(p.note || '')}</td>
  </tr>`).join('') : `<tr><td colspan="5"><div class="empty">فروشی برای اعضای این گروه ثبت نشده</div></td></tr>`;
  openModal(`🛒 تاریخچه فروش به گروه «${escapeHtml(data.family.name)}»`, `
    <div class="family-history-summary">${fa(data.sales.length)} فروش · جمع کل: <strong>${fmt(total)} تومان</strong></div>
    <div class="family-history-table"><table><thead><tr><th>عضو</th><th>نوع فروش</th><th>مبلغ</th><th>تاریخ</th><th>توضیحات</th></tr></thead><tbody>${rows}</tbody></table></div>
  `, [{label:'بستن', cls:'btn-ghost', action:'closeModal()'}]);
}


async function openFamilyPaymentsHistory(familyId) {
  closeFamilyActions();
  const data = await getFamilyFinancialHistory(familyId);
  if (!data) return showToast('گروه پیدا نشد', 'error');
  const totals = new Map();
  data.payments.forEach(p => totals.set(p.currency || 'تومان', (totals.get(p.currency || 'تومان') || 0) + Number(p.amount || 0)));
  const totalLabel = [...totals].map(([currency, amount]) => `${fmt(amount)} ${escapeHtml(currency)}`).join(' + ') || '۰ تومان';
  const rows = data.payments.length ? data.payments.map(p => `<tr>
    <td>${escapeHtml(`${p.member?.name || ''} ${p.member?.lname || ''}`.trim())}</td>
    <td>${escapeHtml(p.pkg_label || 'مانده فعلی')}</td>
    <td><span class="amount amount-paid">${fmt(p.amount)} ${escapeHtml(p.currency || 'تومان')}</span></td>
    <td>${DateService.disp(p.date_jalali) || '—'}</td>
    <td style="color:var(--text3);font-size:11px">${escapeHtml([p.note, p.method].filter(Boolean).join(' · '))}</td>
  </tr>`).join('') : `<tr><td colspan="5"><div class="empty">دریافتی از اعضای این گروه ثبت نشده</div></td></tr>`;
  openModal(`💳 تاریخچه دریافت از گروه «${escapeHtml(data.family.name)}»`, `
    <div class="family-history-summary">${fa(data.payments.length)} دریافت · جمع کل: <strong>${totalLabel}</strong></div>
    <div class="family-history-table"><table><thead><tr><th>عضو</th><th>بابت</th><th>مبلغ</th><th>تاریخ</th><th>یادداشت / پیگیری</th></tr></thead><tbody>${rows}</tbody></table></div>
  `, [{label:'بستن', cls:'btn-ghost', action:'closeModal()'}]);
}


async function openEditReminder(id) {
  const reminders = await window.api.reminders.getAll();
  const r = reminders.find(x => x.id === id);
  if (!r) return;

  openModal(`✏️ ویرایش یادآوری — ${escapeHtml(r.name)} ${escapeHtml(r.lname)}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="er-title" value="${escapeHtml(r.title)}">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ سررسید (شمسی) *</label>
        <input class="form-input jdate" id="er-date" value="${r.due_date_jalali}">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ مورد انتظار (تومان)</label>
        <input class="form-input amount-input" id="er-amount" type="number" value="${r.amount || 0}">
      </div>
      <div class="form-group full">
        <label class="form-label">تکرار</label>
        <select class="form-select" id="er-repeat">
          <option value="0" ${r.repeat_months===0?'selected':''}>بدون تکرار (یک‌بار)</option>
          <option value="1" ${r.repeat_months===1?'selected':''}>هر ۱ ماه</option>
          <option value="3" ${r.repeat_months===3?'selected':''}>هر ۳ ماه</option>
          <option value="6" ${r.repeat_months===6?'selected':''}>هر ۶ ماه</option>
          <option value="12" ${r.repeat_months===12?'selected':''}>هر ۱۲ ماه</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="er-note" value="${escapeHtml(r.note||'')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditReminder(${id})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}


async function saveEditReminder(id) {
  const due = document.getElementById('er-date')?.value;
  if (!due) { showToast('تاریخ سررسید را وارد کنید', 'error'); return; }
  await window.api.reminders.update({
    id,
    patch: {
      title: document.getElementById('er-title')?.value || 'یادآوری پرداخت',
      due_date_jalali: due,
      amount: +(document.getElementById('er-amount')?.value || 0),
      repeat_months: +(document.getElementById('er-repeat')?.value || 0),
      note: document.getElementById('er-note')?.value || '',
      notified_levels: [],
    },
  });
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  await refreshReminderSurface();
}


async function deleteReminder(id) {
  if (!confirm('این یادآوری حذف شود؟')) return;
  await window.api.reminders.delete(id);
  showToast('حذف شد', 'error');
  await refreshReminderSurface();
}

