// TeamPulse deferred UI — suppliers (تامین‌کنندگان), buys, payments, debts.
// Loaded when the suppliers page opens.

var _suppliersTab = 'suppliers';
window._suppliersBuysHistoryView = window._suppliersBuysHistoryView || { range: 'all' };
var _suppliersCategoryFilter = '';
var _suppliersListRenderKey = '';
var _suppliersListShown = {
  buys: typeof PAYMENTS_LIST_CHUNK === 'number' ? PAYMENTS_LIST_CHUNK : 12,
  payments: typeof PAYMENTS_LIST_CHUNK === 'number' ? PAYMENTS_LIST_CHUNK : 12,
  suppliers: typeof STUDENT_LIST_CHUNK === 'number' ? STUDENT_LIST_CHUNK : 20,
  debts: typeof STUDENT_LIST_CHUNK === 'number' ? STUDENT_LIST_CHUNK : 20,
};

function _suppliersModuleOn() {
  return typeof _moduleEnabled !== 'function' || _moduleEnabled('suppliers');
}

function _suppliersSeeMoney() {
  return typeof _teamCanSeeFinanceAmounts !== 'function' || _teamCanSeeFinanceAmounts();
}

function currentSuppliersSearch() {
  const cur = document.querySelector('#content .income-inline-search input') ||
    document.querySelector('#topbar-actions .table-search input') ||
    document.querySelector('#content .table-search input');
  return cur ? cur.value : '';
}

function _syncSuppliersListShown(tab, searchExtra) {
  const key = String(tab || '') + '\0' + String(searchExtra || '');
  if (_suppliersListRenderKey === key) return;
  _suppliersListRenderKey = key;
  const chunk = tab === 'buys' || tab === 'payments'
    ? (typeof PAYMENTS_LIST_CHUNK === 'number' ? PAYMENTS_LIST_CHUNK : 12)
    : (typeof STUDENT_LIST_CHUNK === 'number' ? STUDENT_LIST_CHUNK : 20);
  _suppliersListShown[tab] = chunk;
}

function _visibleSuppliersSlice(tab, items) {
  const list = Array.isArray(items) ? items : [];
  const base = tab === 'buys' || tab === 'payments'
    ? (typeof PAYMENTS_LIST_CHUNK === 'number' ? PAYMENTS_LIST_CHUNK : 12)
    : (typeof STUDENT_LIST_CHUNK === 'number' ? STUDENT_LIST_CHUNK : 20);
  const cap = Math.max(base, Number(_suppliersListShown[tab] || base));
  return { rows: list.slice(0, cap), remaining: Math.max(0, list.length - cap), cap };
}

function _suppliersMoreButtonHtml(tab, remaining) {
  if (!(remaining > 0)) return '';
  return `<button type="button" class="todo-show-more income-show-more" onclick="_suppliersShowMore('${escapeHtml(tab)}')">موارد بیشتر +</button>`;
}

function _suppliersShowMore(tab) {
  const base = tab === 'buys' || tab === 'payments'
    ? (typeof PAYMENTS_LIST_CHUNK === 'number' ? PAYMENTS_LIST_CHUNK : 12)
    : (typeof STUDENT_LIST_CHUNK === 'number' ? STUDENT_LIST_CHUNK : 20);
  _suppliersListShown[tab] = (_suppliersListShown[tab] || base) + base;
  return renderSuppliers(currentSuppliersSearch());
}

function suppliersInlineSearchHtml(search, placeholder) {
  return `<div class="table-search income-inline-search">
    <span style="color:var(--text3)">🔍</span>
    <input placeholder="${escapeHtml(placeholder || 'جست‌وجو در همین فهرست…')}" oninput="renderSuppliers(this.value)" value="${escapeHtml(search)}" aria-label="جست‌وجو">
  </div>`;
}

function suppliersTabsHtml(tab) {
  const tabs = [
    ['suppliers', '🏭 تامین‌کنندگان'],
    ['buys', '🛍 خریدها'],
    ['payments', '💸 پرداخت‌ها'],
    ['debts', '📋 بدهی‌ها'],
  ];
  const btns = tabs.map(([id, label]) =>
    `<button type="button" class="${tab === id ? 'active' : ''}" role="tab" aria-selected="${tab === id}" onclick="_tpSuppliersTab('${id}',1)">${label}</button>`
  ).join('');
  return `<div class="payments-toolbar account-tabs-toolbar">
    <div class="payments-segmented" role="tablist" aria-label="تامین‌کنندگان">
      ${btns}
    </div>
  </div>`;
}

function suppliersTopbarHtml(tab, search) {
  if (tab === 'suppliers') {
    return `${suppliersInlineSearchHtml(search, 'جستجو با نام تامین‌کننده…')}
      <button class="btn btn-primary" type="button" onclick="openAddSupplierStudent()"><span class="btn-icon">+</span><span> تامین‌کننده جدید</span></button>`;
  }
  if (tab === 'buys' || tab === 'payments' || tab === 'debts') {
    const ph = tab === 'payments' ? 'جستجو در پرداخت‌ها…' : tab === 'buys' ? 'جستجو در خریدها…' : 'جستجو در بدهی‌ها…';
    return suppliersInlineSearchHtml(search, ph);
  }
  return '';
}

function _tpSuppliersTab(tab, keepSearch) {
  const next = tab || 'suppliers';
  if (!['suppliers', 'buys', 'payments', 'debts'].includes(next)) return;
  _suppliersTab = next;
  _suppliersListRenderKey = '';
  const search = keepSearch ? currentSuppliersSearch() : '';
  if (currentPage === 'suppliers') renderSuppliers(search);
  else {
    currentPage = 'suppliers';
    renderPage();
  }
}

function _supplierBuysMonthHeaderStats(rowsInSlice, allInMonth) {
  let tomanSum = 0;
  const fx = new Map();
  for (const r of rowsInSlice) {
    const amt = _computePurchaseTotal(r);
    if (_isTomanCurrency(r.currency)) tomanSum += amt;
    else {
      const cur = _moneyCurrency(r.currency);
      fx.set(cur, (fx.get(cur) || 0) + amt);
    }
  }
  const partial = rowsInSlice.length < allInMonth.length;
  return { count: rowsInSlice.length, tomanSum, fx, partial };
}

function _supplierBuysMonthHeaderLabel(mk, stats) {
  const partial = stats.partial ? ' (تا اینجا)' : '';
  let sum = '';
  if (_suppliersSeeMoney()) {
    sum = `جمع ${fmt(stats.tomanSum)} تومان${partial}`;
    if (stats.fx.size) {
      sum += [...stats.fx.entries()].map(([cur, amt]) => ` · ${fmt(amt)} ${escapeHtml(cur)}`).join('');
    }
  }
  const months = typeof JMONTHS !== 'undefined' ? JMONTHS : [];
  const monthName = months[mk.jm - 1] || '';
  return `${monthName} ${fa(mk.jy)} — ${fa(stats.count)} خرید${sum ? ' — ' + sum : ''}`;
}

function _supplierPaymentMonthHeaderStats(rowsInSlice, allInMonth) {
  let tomanSum = 0;
  const fx = new Map();
  for (const r of rowsInSlice) {
    const amt = Number(r.amount) || 0;
    if (_isTomanCurrency(r.currency)) tomanSum += amt;
    else {
      const cur = _moneyCurrency(r.currency);
      fx.set(cur, (fx.get(cur) || 0) + amt);
    }
  }
  const partial = rowsInSlice.length < allInMonth.length;
  return { count: rowsInSlice.length, tomanSum, fx, partial };
}

function _supplierPaymentMonthHeaderLabel(mk, stats) {
  const partial = stats.partial ? ' (تا اینجا)' : '';
  let sum = '';
  if (_suppliersSeeMoney()) {
    sum = `جمع ${fmt(stats.tomanSum)} تومان${partial}`;
    if (stats.fx.size) {
      sum += [...stats.fx.entries()].map(([cur, amt]) => ` · ${fmt(amt)} ${escapeHtml(cur)}`).join('');
    }
  }
  const months = typeof JMONTHS !== 'undefined' ? JMONTHS : [];
  const monthName = months[mk.jm - 1] || '';
  return `${monthName} ${fa(mk.jy)} — ${fa(stats.count)} پرداخت${sum ? ' — ' + sum : ''}`;
}

function suppliersBuysFiltersHtml() {
  const view = window._suppliersBuysHistoryView || { range: 'all' };
  const ranges = [
    ['all', 'همه'],
    ['this_month', 'این ماه'],
    ['last_month', 'ماه قبل'],
    ['last3', '۳ ماه اخیر'],
    ['year', 'امسال'],
  ];
  const rangeChips = ranges.map(([id, label]) =>
    `<button type="button" class="chip ${view.range === id ? 'active' : ''}" onclick="_setSuppliersBuysRange('${id}')">${escapeHtml(label)}</button>`
  ).join('');
  return `<div class="payments-history-filters" style="margin-bottom:10px">
    <div class="chip-bar payments-history-range">${rangeChips}</div>
  </div>`;
}

function _setSuppliersBuysRange(range) {
  window._suppliersBuysHistoryView = { ...(window._suppliersBuysHistoryView || {}), range: range || 'all' };
  _suppliersListRenderKey = '';
  renderSuppliers(currentSuppliersSearch());
}

function _filterSupplierBuysView(rows) {
  const view = window._suppliersBuysHistoryView || { range: 'all' };
  let list = rows || [];
  if (view.range && view.range !== 'all') {
    const matchFn = typeof _paymentsHistoryRangeMatch === 'function'
      ? _paymentsHistoryRangeMatch
      : null;
    if (matchFn) list = list.filter(r => matchFn(r.date_jalali, view.range));
  }
  return list;
}

function _supplierDisplayName(s) {
  if (!s) return '—';
  return `${s.name || ''} ${s.lname || ''}`.trim() || s.organization_name || '—';
}

function _supplierCategoryOptionsHtml(selected) {
  const suppliers = _suppliersForFinance();
  const cats = new Set();
  suppliers.forEach(s => {
    const c = String(s.supplier_category || '').trim();
    if (c) cats.add(c);
  });
  const opts = ['<option value="">همه دسته‌ها</option>'];
  [...cats].sort((a, b) => a.localeCompare(b, 'fa')).forEach(c => {
    opts.push(`<option value="${escapeHtml(c)}" ${String(selected) === c ? 'selected' : ''}>${escapeHtml(c)}</option>`);
  });
  return opts.join('');
}

function _setSuppliersCategoryFilter(val) {
  _suppliersCategoryFilter = String(val || '').trim();
  _suppliersListRenderKey = '';
  renderSuppliers(currentSuppliersSearch());
}

function _supplierRowActionsHtml(s) {
  const sid = Number(s.id);
  const menuId = `supplier-menu-${sid}`;
  const canPay = typeof _teamCan !== 'function' || _teamCan('suppliers');
  return `<div class="row-menu">
    <button class="row-menu-btn" type="button" aria-label="عملیات" aria-haspopup="menu" onclick="toggleRowMenu(event,'${menuId}')">⋮</button>
    <div class="row-menu-panel" id="${menuId}" role="menu">
      <div class="row-menu-item" role="menuitem" onclick="openSupplierEditForm(${sid})">✏️ ویرایش</div>
      <div class="row-menu-item" role="menuitem" onclick="openSupplierPurchaseModal(${sid})">🛍 خرید جدید</div>
      ${canPay ? `<div class="row-menu-item" role="menuitem" onclick="openSupplierPaymentModal(${sid})">💸 ثبت پرداخت</div>` : ''}
      <div class="row-menu-divider"></div>
      <div class="row-menu-item" role="menuitem" onclick="openSupplierTransactions(${sid})">📑 صورتحساب</div>
    </div>
  </div>`;
}

function _purchaseRowActionsHtml(p) {
  const menuId = `sup-buy-menu-${p.id}`;
  return `<div class="row-menu">
    <button class="row-menu-btn" type="button" aria-label="عملیات خرید" aria-haspopup="menu" onclick="toggleRowMenu(event,'${menuId}')">⋮</button>
    <div class="row-menu-panel" id="${menuId}" role="menu">
      <div class="row-menu-item" role="menuitem" onclick="openSupplierPurchaseModal(${Number(p.supplier_id) || 'null'}, ${Number(p.id)})">✏️ ویرایش</div>
      <div class="row-menu-divider"></div>
      <div class="row-menu-item danger" role="menuitem" onclick="deleteSupplierPurchase(${Number(p.id)})">🗑 حذف</div>
    </div>
  </div>`;
}

function _supplierPaymentRowActionsHtml(e) {
  const menuId = `sup-pay-menu-${e.id}`;
  return `<div class="row-menu">
    <button class="row-menu-btn" type="button" aria-label="عملیات پرداخت" aria-haspopup="menu" onclick="toggleRowMenu(event,'${menuId}')">⋮</button>
    <div class="row-menu-panel" id="${menuId}" role="menu">
      <div class="row-menu-item" role="menuitem" onclick="openSupplierPaymentModal(${Number(e.supplier_id) || 'null'}, ${Number(e.id)})">✏️ ویرایش</div>
      <div class="row-menu-divider"></div>
      <div class="row-menu-item danger" role="menuitem" onclick="deleteSupplierPayment(${Number(e.id)})">🗑 حذف</div>
    </div>
  </div>`;
}

function _moneyCell(amount, currency) {
  if (!_suppliersSeeMoney()) return '<span style="color:var(--text3)">—</span>';
  return `<span class="amount amount-paid">${_moneyLabel(amount, currency || 'تومان')}</span>`;
}

function _renderSuppliersTab(search) {
  const q = String(search || '').trim().toLowerCase();
  let suppliers = _suppliersForFinance();
  if (_suppliersCategoryFilter) {
    suppliers = suppliers.filter(s => String(s.supplier_category || '') === _suppliersCategoryFilter);
  }
  if (q) {
    suppliers = suppliers.filter(s => {
      const blob = `${s.name} ${s.lname} ${s.phone} ${s.organization_name} ${s.supplier_category} ${s.contact_name || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }
  suppliers = suppliers.slice().sort((a, b) => _supplierDisplayName(a).localeCompare(_supplierDisplayName(b), 'fa'));
  const slice = _visibleSuppliersSlice('suppliers', suppliers);
  const showMoney = _suppliersSeeMoney();
  const colSpan = showMoney ? 8 : 5;

  let html = `${suppliersTabsHtml('suppliers')}<div class="table-card tbl-responsive supplier-list-table">
    <div class="table-header payments-history-header" style="flex-wrap:wrap;gap:8px">
      <span class="title">🏭 تامین‌کنندگان (${fa(suppliers.length)} نفر)</span>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="form-select" style="min-width:140px" aria-label="فیلتر دسته" onchange="_setSuppliersCategoryFilter(this.value)">${_supplierCategoryOptionsHtml(_suppliersCategoryFilter)}</select>
        <button class="btn btn-primary btn-sm" type="button" title="افزودن تامین‌کننده" onclick="openAddSupplierStudent()">+</button>
      </div>
    </div>`;

  if (!slice.rows.length) {
    html += `<div class="empty"><span>🏭</span>تامین‌کننده‌ای ثبت نشده</div>`;
  } else {
    html += `<table><thead><tr>
      <th>نام</th><th>دسته</th><th>تماس</th><th>شرایط پرداخت</th>
      ${showMoney ? '<th>جمع خرید</th><th>پرداخت‌شده</th><th>بدهی ما</th>' : ''}
      <th>عملیات</th>
    </tr></thead><tbody>`;
    for (const s of slice.rows) {
      const sum = _supplierListSummary(s.id);
      html += `<tr>
        <td data-label="نام" style="font-weight:500">${escapeHtml(_supplierDisplayName(s))}</td>
        <td data-label="دسته">${escapeHtml(s.supplier_category || '—')}</td>
        <td data-label="تماس" style="font-size:12px;color:var(--text2)">${escapeHtml(s.phone || '—')}${s.contact_name ? `<div style="font-size:11px;color:var(--text3)">${escapeHtml(s.contact_name)}</div>` : ''}</td>
        <td data-label="شرایط پرداخت" style="font-size:12px;color:var(--text2)">${escapeHtml(s.payment_terms || '—')}</td>
        ${showMoney ? `<td data-label="جمع خرید">${_moneyCell(sum.purchaseToman, 'تومان')}</td>` : ''}
        ${showMoney ? `<td data-label="پرداخت‌شده">${_moneyCell(sum.paidToman, 'تومان')}</td>` : ''}
        ${showMoney ? `<td data-label="بدهی ما">${balanceHtml(sum.balance, true)}</td>` : ''}
        <td data-label="عملیات">${_supplierRowActionsHtml(s)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  html += `${_suppliersMoreButtonHtml('suppliers', slice.remaining)}</div>`;
  return html;
}

async function _renderSuppliersBuysTab(search) {
  let purchases = await window.api.purchases.getAll();
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    purchases = purchases.filter(p => {
      const blob = `${p.supplier_name || ''} ${p.name || ''} ${p.lname || ''} ${_purchaseItemsSummary(p)} ${p.note || ''} ${p.invoice_no || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }
  purchases = _filterSupplierBuysView(purchases);
  purchases = _sortPurchasesNewestFirst(purchases);
  _syncSuppliersListShown('buys', `${search}\x1e${(window._suppliersBuysHistoryView || {}).range || 'all'}`);
  const slice = _visibleSuppliersSlice('buys', purchases);
  const showMoney = _suppliersSeeMoney();
  const colSpan = showMoney ? 8 : 6;
  const buildLayout = typeof _buildIncomeMonthLayout === 'function' ? _buildIncomeMonthLayout : null;

  let html = `${suppliersTabsHtml('buys')}${suppliersBuysFiltersHtml()}<div class="table-card tbl-responsive supplier-buys-table">
    <div class="table-header payments-history-header" style="flex-wrap:wrap;gap:8px">
      <span class="title">🛍 تاریخچه خرید از تامین‌کنندگان (${fa(purchases.length)} مورد)</span>
      <button class="btn btn-primary btn-sm" type="button" title="خرید جدید" onclick="openSupplierPurchaseModal()">+</button>
    </div>`;

  if (!purchases.length) {
    html += `<div class="empty"><span>🛍</span>خریدی از تامین‌کنندگان ثبت نشده</div>`;
  } else if (buildLayout) {
    const layout = buildLayout(slice.rows, purchases, 'date_jalali', _supplierBuysMonthHeaderStats);
    html += '<table><thead><tr>' +
      '<th>تامین‌کننده</th><th>اقلام</th>' +
      (showMoney ? '<th>جمع</th>' : '') +
      '<th>تاریخ / سررسید</th><th>فاکتور</th><th>یادداشت</th><th>عملیات</th>' +
      '</tr></thead><tbody>';
    for (const block of layout) {
      if (block.kind === 'month') {
        html += `<tr class="payments-month-row"><td colspan="${colSpan}">${escapeHtml(_supplierBuysMonthHeaderLabel(block.mk, block.stats))}</td></tr>`;
        continue;
      }
      const p = block.p;
      html += `<tr id="sup-purchase-row-${p.id}">
        <td data-label="تامین‌کننده" style="font-weight:500">${escapeHtml(p.supplier_name || _supplierDisplayName({ name: p.name, lname: p.lname }))}</td>
        <td data-label="اقلام" style="font-size:12px">${escapeHtml(_purchaseItemsSummary(p))}</td>
        ${showMoney ? `<td data-label="جمع">${_moneyCell(_computePurchaseTotal(p), p.currency)}</td>` : ''}
        <td data-label="تاریخ" style="color:var(--text2);font-size:12px">
          <div>خرید: ${DateService.disp(p.date_jalali) || '—'}</div>
          <div style="font-size:10px;margin-top:2px">سررسید: ${DateService.disp(p.due_date_jalali) || '—'}</div>
        </td>
        <td data-label="فاکتور">${escapeHtml(p.invoice_no || '—')}</td>
        <td data-label="یادداشت" style="font-size:11px;color:var(--text3)">${escapeHtml(p.note || '')}</td>
        <td data-label="عملیات">${_purchaseRowActionsHtml(p)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  } else {
    html += '<table><tbody>';
    for (const p of slice.rows) {
      html += `<tr id="sup-purchase-row-${p.id}">
        <td data-label="تامین‌کننده">${escapeHtml(p.supplier_name || '')}</td>
        <td data-label="اقلام">${escapeHtml(_purchaseItemsSummary(p))}</td>
        ${showMoney ? `<td data-label="جمع">${_moneyCell(_computePurchaseTotal(p), p.currency)}</td>` : ''}
        <td data-label="تاریخ">${DateService.disp(p.date_jalali) || '—'}</td>
        <td data-label="عملیات">${_purchaseRowActionsHtml(p)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  html += `${_suppliersMoreButtonHtml('buys', slice.remaining)}</div>`;
  return html;
}

function _renderSuppliersPaymentsTab(search) {
  const q = String(search || '').trim().toLowerCase();
  const supplierById = new Map((_suppliersForFinance() || []).map(s => [String(s.id), s]));
  let expenses = (_db.expenses || []).filter(e => e && e.source === 'supplier_payment');
  expenses = expenses.map(e => {
    const sup = supplierById.get(String(e.supplier_id));
    return {
      ...e,
      name: sup ? sup.name : '',
      lname: sup ? sup.lname : '',
      supplier_name: sup ? _supplierDisplayName(sup) : '—',
      account_label: ((_db.financial_accounts || []).find(a => String(a.id) === String(e.account_id)) || {}).name || '',
    };
  });
  if (q) {
    expenses = expenses.filter(e => {
      const blob = `${e.supplier_name} ${e.note || ''} ${e.description || ''} ${e.payment_method || ''}`.toLowerCase();
      return blob.includes(q);
    });
  }
  if (typeof _sortPaymentsNewestFirst === 'function') {
    expenses = _sortPaymentsNewestFirst(expenses.map(e => ({ ...e, date_jalali: e.date_jalali })));
  } else {
    expenses = expenses.slice().sort((a, b) => _jalaliKey(b.date_jalali) - _jalaliKey(a.date_jalali) || Number(b.id) - Number(a.id));
  }
  _syncSuppliersListShown('payments', search);
  const slice = _visibleSuppliersSlice('payments', expenses);
  const showMoney = _suppliersSeeMoney();
  const buildLayout = typeof _buildIncomeMonthLayout === 'function' ? _buildIncomeMonthLayout : null;
  const colSpan = showMoney ? 7 : 5;

  let html = `${suppliersTabsHtml('payments')}<div class="table-card tbl-responsive supplier-payments-table">
    <div class="table-header payments-history-header" style="flex-wrap:wrap;gap:8px">
      <span class="title">💸 پرداخت به تامین‌کنندگان (${fa(expenses.length)} مورد)</span>
      <button class="btn btn-primary btn-sm" type="button" title="پرداخت جدید" onclick="openSupplierPaymentModal()">+</button>
    </div>`;

  if (!expenses.length) {
    html += `<div class="empty"><span>💸</span>پرداختی به تامین‌کنندگان ثبت نشده</div>`;
  } else if (buildLayout) {
    const layout = buildLayout(slice.rows, expenses, 'date_jalali', _supplierPaymentMonthHeaderStats);
    html += `<table><thead><tr>
      <th>تامین‌کننده</th><th>تاریخ</th>${showMoney ? '<th>مبلغ</th>' : ''}<th>حساب</th><th>روش</th><th>یادداشت</th><th>عملیات</th>
    </tr></thead><tbody>`;
    for (const block of layout) {
      if (block.kind === 'month') {
        html += `<tr class="payments-month-row"><td colspan="${colSpan}">${escapeHtml(_supplierPaymentMonthHeaderLabel(block.mk, block.stats))}</td></tr>`;
        continue;
      }
      const e = block.p;
      html += `<tr>
        <td data-label="تامین‌کننده" style="font-weight:500">${escapeHtml(e.supplier_name)}</td>
        <td data-label="تاریخ">${DateService.disp(e.date_jalali) || '—'}</td>
        ${showMoney ? `<td data-label="مبلغ">${_moneyCell(e.amount, e.currency)}</td>` : ''}
        <td data-label="حساب" style="font-size:12px;color:var(--text2)">${escapeHtml(e.account_label || '—')}</td>
        <td data-label="روش" style="font-size:12px">${escapeHtml(e.payment_method || '—')}</td>
        <td data-label="یادداشت" style="font-size:11px;color:var(--text3)">${escapeHtml(e.note || e.description || '')}</td>
        <td data-label="عملیات">${_supplierPaymentRowActionsHtml(e)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  } else {
    html += `<table><thead><tr>
      <th>تامین‌کننده</th><th>تاریخ</th>${showMoney ? '<th>مبلغ</th>' : ''}<th>حساب</th><th>روش</th><th>یادداشت</th><th>عملیات</th>
    </tr></thead><tbody>`;
    for (const e of slice.rows) {
      html += `<tr>
        <td data-label="تامین‌کننده" style="font-weight:500">${escapeHtml(e.supplier_name)}</td>
        <td data-label="تاریخ">${DateService.disp(e.date_jalali) || '—'}</td>
        ${showMoney ? `<td data-label="مبلغ">${_moneyCell(e.amount, e.currency)}</td>` : ''}
        <td data-label="حساب" style="font-size:12px;color:var(--text2)">${escapeHtml(e.account_label || '—')}</td>
        <td data-label="روش" style="font-size:12px">${escapeHtml(e.payment_method || '—')}</td>
        <td data-label="یادداشت" style="font-size:11px;color:var(--text3)">${escapeHtml(e.note || e.description || '')}</td>
        <td data-label="عملیات">${_supplierPaymentRowActionsHtml(e)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  html += `${_suppliersMoreButtonHtml('payments', slice.remaining)}</div>`;
  return html;
}

function _renderSuppliersDebtsTab(search) {
  const q = String(search || '').trim().toLowerCase();
  let rows = _suppliersForFinance().map(s => {
    const sum = _supplierListSummary(s.id);
    return { ...s, ...sum };
  }).filter(r => Number(r.balance) > 0);
  if (q) {
    rows = rows.filter(s => `${s.name} ${s.lname} ${s.phone}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => Number(b.balance) - Number(a.balance));
  _syncSuppliersListShown('debts', search);
  const slice = _visibleSuppliersSlice('debts', rows);
  const showMoney = _suppliersSeeMoney();

  let html = `${suppliersTabsHtml('debts')}<div class="table-card tbl-responsive supplier-debts-table">
    <div class="table-header"><span class="title">📋 بدهی به تامین‌کنندگان (${fa(rows.length)} نفر)</span></div>`;

  if (!slice.rows.length) {
    html += `<div class="empty"><span>✓</span>بدهی باز به تامین‌کننده ندارید</div>`;
  } else {
    html += `<table><thead><tr>
      <th>تامین‌کننده</th><th>تماس</th>
      ${showMoney ? '<th>جمع خرید</th><th>پرداخت‌شده</th><th>بدهی ما</th>' : ''}
      <th>عملیات</th>
    </tr></thead><tbody>`;
    for (const s of slice.rows) {
      html += `<tr>
        <td data-label="تامین‌کننده" style="font-weight:500">${escapeHtml(_supplierDisplayName(s))}</td>
        <td data-label="تماس">${escapeHtml(s.phone || '—')}</td>
        ${showMoney ? `<td data-label="جمع خرید">${_moneyCell(s.purchaseToman, 'تومان')}</td>` : ''}
        ${showMoney ? `<td data-label="پرداخت‌شده">${_moneyCell(s.paidToman, 'تومان')}</td>` : ''}
        ${showMoney ? `<td data-label="بدهی ما">${balanceHtml(s.balance, true)}</td>` : ''}
        <td data-label="عملیات">
          <button class="btn btn-primary btn-sm" type="button" onclick="openSupplierPaymentModal(${Number(s.id)})">💸 پرداخت</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  html += `${_suppliersMoreButtonHtml('debts', slice.remaining)}</div>`;
  return html;
}

async function renderSuppliers(search) {
  if (currentPage !== 'suppliers') return;
  if (!_suppliersModuleOn()) {
    updateTopbarActions('');
    setContent(`<div class="empty" style="padding:48px"><span>🏭</span>ماژول تامین‌کنندگان غیرفعال است</div>`);
    return;
  }
  const tab = _suppliersTab || 'suppliers';
  updateTopbarActions(suppliersTopbarHtml(tab, search));

  try {
    if (typeof _ensureCompleteBusinessParts === 'function') {
      if (tab === 'buys') await _ensureCompleteBusinessParts(['students', 'purchases']);
      else if (tab === 'payments') await _ensureCompleteBusinessParts(['students', 'expenses', 'financial_accounts']);
      else await _ensureCompleteBusinessParts(['students', 'purchases', 'expenses']);
    } else if (typeof _ensureBusinessPartLoaded === 'function') {
      await _ensureBusinessPartLoaded('students');
      if (tab === 'buys' || tab === 'suppliers' || tab === 'debts') await _ensureBusinessPartLoaded('purchases');
      if (tab === 'payments' || tab === 'suppliers' || tab === 'debts') await _ensureBusinessPartLoaded('expenses');
    }
  } catch (e) { /* offline cache */ }

  if (!allStudents.length && window.api?.students?.getAll) {
    allStudents = await window.api.students.getAll();
  }

  let html = '';
  if (tab === 'suppliers') html = _renderSuppliersTab(search);
  else if (tab === 'buys') html = await _renderSuppliersBuysTab(search);
  else if (tab === 'payments') html = _renderSuppliersPaymentsTab(search);
  else if (tab === 'debts') html = _renderSuppliersDebtsTab(search);
  else html = _renderSuppliersTab(search);

  setContent(html);
  if (search) {
    requestAnimationFrame(() => {
      const sp = document.querySelector('#topbar-actions .table-search input') ||
        document.querySelector('.table-search input');
      if (sp) {
        sp.focus();
        try { sp.setSelectionRange(search.length, search.length); } catch (err) { /* */ }
      }
    });
  }
}

function _supplierPickerOptionsHtml(selectedId) {
  const suppliers = _suppliersForFinance();
  return suppliers.map(s =>
  `<option value="${s.id}" ${String(selectedId) === String(s.id) ? 'selected' : ''}>${escapeHtml(_supplierDisplayName(s))}</option>`
  ).join('') || '<option value="">— تامین‌کننده‌ای نیست —</option>';
}

function _supplierPurchaseItemRowHtml(item, idx) {
  const it = item || {};
  return `<div class="form-grid sp-item-row" data-sp-item="${idx}" style="margin-bottom:8px;padding:10px;border:1px solid var(--border2);border-radius:10px;background:var(--bg3)">
    <div class="form-group" style="grid-column:1/-1">
      <label class="form-label">شرح کالا / خدمت</label>
      <input class="form-input sp-item-name" type="text" value="${escapeHtml(it.name || '')}" placeholder="مثلاً قهوه عربیکا" oninput="_recalcSupplierPurchaseTotal()">
    </div>
    <div class="form-group">
      <label class="form-label">تعداد</label>
      <input class="form-input sp-item-qty" type="number" min="0" step="any" value="${it.qty != null ? Number(it.qty) : 1}" oninput="_recalcSupplierPurchaseTotal()">
    </div>
    <div class="form-group">
      <label class="form-label">قیمت واحد</label>
      <input class="form-input sp-item-price amount-input" type="number" min="0" value="${it.unit_price != null ? Number(it.unit_price) : ''}" oninput="_recalcSupplierPurchaseTotal()">
    </div>
    <div class="form-group" style="display:flex;align-items:flex-end">
      <button type="button" class="btn btn-danger btn-sm" onclick="_removeSupplierPurchaseItemRow(${idx})">حذف ردیف</button>
    </div>
  </div>`;
}

function _readSupplierPurchaseItems() {
  const rows = [...document.querySelectorAll('#sp-items .sp-item-row')];
  return rows.map(row => ({
    name: String(row.querySelector('.sp-item-name')?.value || '').trim(),
    qty: Number(row.querySelector('.sp-item-qty')?.value) || 0,
    unit_price: Number(row.querySelector('.sp-item-price')?.value) || 0,
  })).filter(it => it.name || it.qty || it.unit_price);
}

function _recalcSupplierPurchaseTotal() {
  const items = _readSupplierPurchaseItems();
  const draft = { items };
  const manual = Number(document.getElementById('sp-total')?.value);
  const total = items.length ? _computePurchaseTotal(draft) : manual;
  const el = document.getElementById('sp-total-display');
  if (el) el.textContent = fmt(total);
  const inp = document.getElementById('sp-total');
  if (inp && items.length) inp.value = String(total);
}

function _addSupplierPurchaseItemRow() {
  const box = document.getElementById('sp-items');
  if (!box) return;
  const idx = box.querySelectorAll('.sp-item-row').length;
  box.insertAdjacentHTML('beforeend', _supplierPurchaseItemRowHtml({}, idx));
  _recalcSupplierPurchaseTotal();
}

function _removeSupplierPurchaseItemRow(idx) {
  const row = document.querySelector(`#sp-items .sp-item-row[data-sp-item="${idx}"]`);
  if (row) row.remove();
  [...document.querySelectorAll('#sp-items .sp-item-row')].forEach((el, i) => { el.dataset.spItem = String(i); });
  _recalcSupplierPurchaseTotal();
}

function onSupplierPurchaseSupplierChange() {
  const sid = document.getElementById('sp-supplier')?.value;
  const supplier = (_suppliersForFinance() || []).find(s => String(s.id) === String(sid));
  const dateVal = readCalendarDateField('sp-date') || _formatJalali(...todayJalali());
  const dueEl = document.getElementById('sp-due');
  if (dueEl && supplier && typeof _dueDateFromPaymentTerms === 'function') {
    dueEl.value = _dueDateFromPaymentTerms(supplier, dateVal) || '';
  }
}

function _supplierPurchaseOptionsForPayment(supplierId, selectedPurchaseId) {
  const purchases = _rowsForSupplier('purchases', supplierId);
  const opts = ['<option value="">— بدون اتصال به خرید —</option>'];
  purchases.forEach(p => {
    const label = `${DateService.disp(p.date_jalali) || '—'} · ${escapeHtml(_purchaseItemsSummary(p))} · ${fmt(_computePurchaseTotal(p))}`;
    opts.push(`<option value="${p.id}" ${String(selectedPurchaseId) === String(p.id) ? 'selected' : ''}>${label}</option>`);
  });
  return opts.join('');
}

function onSupplierPaymentSupplierChange() {
  const sid = document.getElementById('spay-supplier')?.value;
  const sum = sid ? _supplierListSummary(sid) : { balance: 0 };
  const amt = document.getElementById('spay-amount');
  if (amt && !amt.dataset.userEdited) amt.value = sum.balance > 0 ? String(sum.balance) : '';
  const pur = document.getElementById('spay-purchase');
  if (pur) pur.innerHTML = _supplierPurchaseOptionsForPayment(sid, pur.value);
}

async function openSupplierPurchaseModal(supplierId, purchaseId) {
  if (typeof _ensureBusinessPartLoaded === 'function') {
    try {
      await _ensureBusinessPartLoaded('students');
      await _ensureBusinessPartLoaded('purchases');
    } catch (e) { /* */ }
  }
  const suppliers = _suppliersForFinance();
  if (!suppliers.length) {
    showToast('ابتدا یک تامین‌کننده ثبت کنید', 'error');
    return;
  }
  const editing = purchaseId != null && purchaseId !== '';
  let purchase = null;
  if (editing) {
    const all = await window.api.purchases.getAll();
    purchase = all.find(p => String(p.id) === String(purchaseId));
    if (!purchase) { showToast('خرید پیدا نشد', 'error'); return; }
    supplierId = purchase.supplier_id;
  }
  const sid = supplierId || suppliers[0].id;
  const supplier = suppliers.find(s => String(s.id) === String(sid)) || suppliers[0];
  const items = (purchase && Array.isArray(purchase.items) && purchase.items.length)
    ? purchase.items
    : [{ name: '', qty: 1, unit_price: '' }];
  const today = _formatJalali(...todayJalali());
  const dateVal = purchase?.date_jalali || today;
  const dueDefault = purchase?.due_date_jalali
    || (typeof _dueDateFromPaymentTerms === 'function' ? _dueDateFromPaymentTerms(supplier, dateVal) : '');
  const total = purchase ? _computePurchaseTotal(purchase) : 0;
  const itemsHtml = items.map((it, i) => _supplierPurchaseItemRowHtml(it, i)).join('');

  openModal(editing ? '✏️ ویرایش خرید از تامین‌کننده' : '🛍 خرید از تامین‌کننده', `
    <div class="form-grid purchase-compact">
      <div class="form-group full">
        <label class="form-label">تامین‌کننده *</label>
        <select class="form-select" id="sp-supplier" onchange="onSupplierPurchaseSupplierChange()">${_supplierPickerOptionsHtml(sid)}</select>
      </div>
      <div class="form-group">
        ${calendarDateFieldHtml('sp-date', dateVal, 'تاریخ خرید')}
      </div>
      <div class="form-group">
        <label class="form-label">سررسید پرداخت</label>
        <input class="form-input jdate" id="sp-due" value="${escapeHtml(dueDefault)}" placeholder="انتخاب تاریخ">
      </div>
      <div class="form-group full">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">
          <label class="form-label" style="margin:0">اقلام خرید</label>
          <button type="button" class="btn btn-ghost btn-sm" onclick="_addSupplierPurchaseItemRow()">+ ردیف</button>
        </div>
        <div id="sp-items">${itemsHtml}</div>
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ کل</label>
        <input class="form-input amount-input" id="sp-total" type="number" value="${total || ''}" oninput="_recalcSupplierPurchaseTotal()">
        <p style="font-size:11px;color:var(--text3);margin:4px 0 0">جمع محاسبه‌شده: <strong id="sp-total-display">${fmt(total)}</strong></p>
      </div>
      <div class="form-group">
        <label class="form-label">واحد پول</label>
        <select class="form-select" id="sp-currency" disabled title="فاز ۱: خرید فقط به تومان؛ گزارش هزینه‌ها چندارزی نیست"><option value="تومان" selected>تومان</option></select>
      </div>
      <div class="form-group">
        <label class="form-label">شماره فاکتور</label>
        <input class="form-input" id="sp-invoice" value="${escapeHtml(purchase?.invoice_no || '')}" placeholder="اختیاری">
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="sp-note" value="${escapeHtml(purchase?.note || '')}">
      </div>
      ${editing ? '' : `<div class="form-group full">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">
          <input type="checkbox" id="sp-pay-now"> همین الان پرداخت ثبت شود
        </label>
      </div>`}
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveSupplierPurchase(${editing ? Number(purchaseId) : 'null'})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
  _recalcSupplierPurchaseTotal();
}

async function saveSupplierPurchase(purchaseId) {
  const supplierId = +(document.getElementById('sp-supplier')?.value || 0);
  if (!supplierId) { showToast('تامین‌کننده را انتخاب کنید', 'error'); return; }
  const dateJalali = readCalendarDateField('sp-date');
  if (!dateJalali) { showToast('تاریخ خرید را وارد کنید', 'error'); return; }
  const items = _readSupplierPurchaseItems();
  const totalManual = +(document.getElementById('sp-total')?.value || 0);
  const draft = { items, total_amount: totalManual };
  const total = items.length ? _computePurchaseTotal(draft) : totalManual;
  if (!(total > 0)) { showToast('مبلغ خرید را وارد کنید', 'error'); return; }
  const payload = {
    supplier_id: supplierId,
    date_jalali: dateJalali,
    due_date_jalali: (document.getElementById('sp-due')?.value || '').trim(),
    items,
    total_amount: total,
    currency: 'تومان',
    invoice_no: (document.getElementById('sp-invoice')?.value || '').trim(),
    note: (document.getElementById('sp-note')?.value || '').trim(),
  };
  const editing = purchaseId != null && purchaseId !== '' && !Number.isNaN(Number(purchaseId));
  let savedId = editing ? Number(purchaseId) : null;
  if (editing) {
    await window.api.purchases.update({ id: savedId, ...payload });
  } else {
    const res = await window.api.purchases.add(payload);
    savedId = res?.id != null ? Number(res.id) : savedId;
    const payNow = !!document.getElementById('sp-pay-now')?.checked;
    if (payNow && savedId != null && typeof _syncSupplierPaymentExpense === 'function') {
      _syncSupplierPaymentExpense({
        supplier_id: supplierId,
        purchase_id: savedId,
        amount: total,
        currency: payload.currency,
        date_jalali: dateJalali,
        payment_method: 'نقدی',
        note: 'پرداخت هنگام ثبت خرید',
      });
    }
  }
  try { if (typeof _syncToServer === 'function') await _syncToServer(); } catch (e) { /* */ }
  closeModal();
  showToast('خرید ذخیره شد ✓', 'success');
  if (currentPage === 'suppliers') await renderSuppliers(currentSuppliersSearch());
  else if (typeof renderPage === 'function') await renderPage();
}

async function deleteSupplierPurchase(id) {
  if (!id) return;
  if (!await tpConfirm('این خرید از تامین‌کننده حذف شود؟')) return;
  const refresh = async () => {
    if (currentPage === 'suppliers') await renderSuppliers(currentSuppliersSearch());
    else if (typeof renderPage === 'function') await renderPage();
  };
  if (typeof _tpUndoableDelete === 'function') {
    await _tpUndoableDelete({
      label: 'خرید حذف شد',
      collections: ['purchases'],
      run: async () => { await window.api.purchases.delete(id); },
      refresh,
    });
  } else {
    await window.api.purchases.delete(id);
    showToast('حذف شد ✓', 'success');
    await refresh();
  }
  const el = document.getElementById('sup-purchase-row-' + id);
  if (el) {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
  }
}

async function openSupplierPaymentModal(supplierId, expenseId) {
  if (typeof _ensureBusinessPartLoaded === 'function') {
    try {
      await _ensureBusinessPartLoaded('students');
      await _ensureBusinessPartLoaded('expenses');
      await _ensureBusinessPartLoaded('purchases');
    } catch (e) { /* */ }
  }
  const suppliers = _suppliersForFinance();
  if (!suppliers.length) {
    showToast('تامین‌کننده‌ای ثبت نشده', 'error');
    return;
  }
  const editing = expenseId != null && expenseId !== '';
  let expense = null;
  if (editing) {
    expense = (_db.expenses || []).find(e => String(e.id) === String(expenseId));
    if (!expense || expense.source !== 'supplier_payment') {
      showToast('پرداخت پیدا نشد', 'error');
      return;
    }
    supplierId = expense.supplier_id;
  }
  const sid = supplierId || suppliers[0].id;
  const sum = _supplierListSummary(sid);
  const today = _formatJalali(...todayJalali());
  const methods = typeof EXPENSE_PAYMENT_METHODS !== 'undefined'
    ? EXPENSE_PAYMENT_METHODS
    : ['کارت', 'انتقال بانکی', 'نقدی', 'چک', 'کیف پول', 'سایر'];
  const methodOpts = methods.map(m =>
    `<option ${expense?.payment_method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`
  ).join('');

  openModal(editing ? '✏️ ویرایش پرداخت به تامین‌کننده' : '💸 پرداخت به تامین‌کننده', `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">تامین‌کننده *</label>
        <select class="form-select" id="spay-supplier" onchange="onSupplierPaymentSupplierChange()">${_supplierPickerOptionsHtml(sid)}</select>
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ *</label>
        <input class="form-input amount-input" id="spay-amount" type="number" value="${expense ? Number(expense.amount) : (sum.balance > 0 ? sum.balance : '')}">
        ${sum.balance > 0 ? `<p style="font-size:11px;color:var(--text3);margin:4px 0 0">بدهی فعلی: ${balanceHtml(sum.balance, true)}</p>` : ''}
      </div>
      <div class="form-group">
        ${calendarDateFieldHtml('spay-date', expense?.date_jalali || today, 'تاریخ پرداخت')}
      </div>
      <div class="form-group">
        <label class="form-label">پرداخت از حساب</label>
        <select class="form-select" id="spay-account">${financialAccountOptionsHtml(expense?.account_id)}</select>
      </div>
      <div class="form-group">
        <label class="form-label">روش پرداخت</label>
        <select class="form-select" id="spay-method">${methodOpts}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">اتصال به خرید (اختیاری)</label>
        <select class="form-select" id="spay-purchase">${_supplierPurchaseOptionsForPayment(sid, expense?.purchase_id)}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="spay-note" value="${escapeHtml(expense?.note || expense?.description || '')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره پرداخت', cls: 'btn-primary', action: `saveSupplierPayment(${editing ? Number(expenseId) : 'null'})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}

async function saveSupplierPayment(expenseId) {
  const supplierId = +(document.getElementById('spay-supplier')?.value || 0);
  if (!supplierId) { showToast('تامین‌کننده را انتخاب کنید', 'error'); return; }
  const amount = +(document.getElementById('spay-amount')?.value || 0);
  if (!(amount > 0)) { showToast('مبلغ پرداخت را وارد کنید', 'error'); return; }
  const dateJalali = readCalendarDateField('spay-date');
  if (!dateJalali) { showToast('تاریخ پرداخت را وارد کنید', 'error'); return; }
  const payload = {
    supplier_id: supplierId,
    amount,
    currency: 'تومان',
    date_jalali: dateJalali,
    account_id: document.getElementById('spay-account')?.value || null,
    payment_method: document.getElementById('spay-method')?.value || 'سایر',
    purchase_id: document.getElementById('spay-purchase')?.value || null,
    note: (document.getElementById('spay-note')?.value || '').trim(),
  };
  const editing = expenseId != null && expenseId !== '' && !Number.isNaN(Number(expenseId));
  if (typeof _syncSupplierPaymentExpense === 'function') {
    _syncSupplierPaymentExpense({ ...payload, id: editing ? Number(expenseId) : undefined });
  } else {
    const data = {
      amount,
      date_jalali: dateJalali,
      category: 'پرداخت تامین‌کننده',
      payment_method: payload.payment_method,
      account_id: payload.account_id,
      description: payload.note || 'پرداخت به تامین‌کننده',
      note: payload.note,
      source: 'supplier_payment',
      supplier_id: supplierId,
      purchase_id: payload.purchase_id,
      currency: 'تومان',
      updated_at: new Date().toISOString(),
    };
    if (editing) {
      const ex = (_db.expenses || []).find(e => String(e.id) === String(expenseId));
      if (ex) Object.assign(ex, data);
    } else {
      const row = { id: _nextId('expenses'), created_at: new Date().toISOString(), ...data };
      _db.expenses = _db.expenses || [];
      _db.expenses.push(row);
      if (typeof _enqueueDurableBusinessDelta === 'function') _enqueueDurableBusinessDelta('expenses', row, 'upsert');
    }
    if (typeof _save === 'function') _save(true, { urgent: true });
  }
  try { if (typeof _syncToServer === 'function') await _syncToServer(); } catch (e) { /* */ }
  closeModal();
  showToast('پرداخت ذخیره شد ✓', 'success');
  if (currentPage === 'suppliers') await renderSuppliers(currentSuppliersSearch());
  else if (typeof renderPage === 'function') await renderPage();
}

async function deleteSupplierPayment(id) {
  if (!id) return;
  const expense = (_db.expenses || []).find(e => String(e.id) === String(id));
  if (!expense) return;
  if (!await tpConfirm('این پرداخت به تامین‌کننده حذف شود؟')) return;
  const refresh = async () => {
    if (currentPage === 'suppliers') await renderSuppliers(currentSuppliersSearch());
    else if (typeof renderPage === 'function') await renderPage();
  };
  if (typeof _removeSupplierPaymentExpense === 'function') {
    if (typeof _tpUndoableDelete === 'function') {
      await _tpUndoableDelete({
        label: 'پرداخت حذف شد',
        collections: ['expenses'],
        run: async () => { _removeSupplierPaymentExpense(expense); },
        refresh,
      });
    } else {
      _removeSupplierPaymentExpense(expense);
      showToast('حذف شد ✓', 'success');
      await refresh();
    }
  } else if (typeof _tpUndoableDelete === 'function') {
    await _tpUndoableDelete({
      label: 'پرداخت حذف شد',
      collections: ['expenses'],
      run: async () => {
        _recordDeletedItems('expenses', id);
        _db.expenses = (_db.expenses || []).filter(e => String(e.id) !== String(id));
        if (typeof _enqueueDurableBusinessDelta === 'function') _enqueueDurableBusinessDelta('expenses', expense, 'delete');
        if (typeof _save === 'function') _save(true, { urgent: true });
      },
      refresh,
    });
  }
}

async function openSupplierTransactions(supplierId) {
  if (!allStudents.length && window.api?.students?.getAll) {
    allStudents = await window.api.students.getAll();
  }
  const s = allStudents.find(x => String(x.id) === String(supplierId));
  if (!s || !_isSupplierStudent(s)) {
    showToast('تامین‌کننده پیدا نشد', 'error');
    return;
  }
  if (typeof _openPartyTransactions !== 'function') {
    try {
      await _tpEnsureChunk('app-finance.js');
    } catch (e) {
      showToast('ماژول مالی هنوز بارگذاری نشده', 'error');
      return;
    }
    if (typeof _openPartyTransactions !== 'function') {
      showToast('صورتحساب در دسترس نیست', 'error');
      return;
    }
  }
  let purchases = _rowsForSupplier('purchases', supplierId);
  let payments = _rowsForSupplier('supplier_payments', supplierId);
  if (window.api?.purchases?.getBySupplier) {
    try { purchases = await window.api.purchases.getBySupplier(supplierId); } catch (e) { /* */ }
  }
  const expenses = (_db.expenses || []).filter(e => e.source === 'supplier_payment' && String(e.supplier_id) === String(supplierId));
  payments = expenses.map(e => ({
    ...e,
    date_jalali: e.date_jalali,
    amount: e.amount,
    currency: e.currency || 'تومان',
    note: e.note || e.description,
    method: e.payment_method,
    pkg_label: e.purchase_id ? 'پرداخت بابت خرید' : 'پرداخت به تامین‌کننده',
  }));
  const sum = _supplierListSummary(supplierId);
  const sales = purchases.map(p => ({
    ...p,
    start_date: p.date_jalali,
    total_amount: _computePurchaseTotal(p),
    type_label: _purchaseItemsSummary(p),
    name: s.name,
    lname: s.lname,
    initial_cost: 0,
    currency: p.currency || 'تومان',
  }));
  _openPartyTransactions({
    mode: 'supplier',
    title: `صورتحساب ${s.name} ${s.lname}`.trim(),
    partyName: _supplierDisplayName(s),
    partySub: [s.phone, s.organization_name, s.supplier_category].filter(Boolean).join(' · '),
    isGroup: false,
    sales,
    payments,
    totalAmount: sum.purchaseToman,
    totalPaid: sum.paidToman,
    wallet: 0,
    balance: sum.balance,
  });
}

function openAddSupplierStudent() {
  openSupplierForm(null);
}

// ویرایش: تامین‌کننده خالص با فرم فشرده؛ کسی که مشتری هم هست یا خدمت ثبت‌شده دارد با فرم کامل پرونده
function openSupplierEditForm(id) {
  const s = (_db.students || []).find(x => String(x.id) === String(id));
  if (!s) return;
  const roles = _partyRoles(s);
  const hasPackages = (_db.packages || []).some(p => String(p.student_id) === String(s.id));
  if (roles.is_client || hasPackages) { openStudentModal(s.id); return; }
  openSupplierForm(s.id);
}

const SUPPLIER_PAYMENT_TERMS = ['نقدی', '۷ روزه', '۱۵ روزه', '۳۰ روزه', '۶۰ روزه', 'چکی', 'سایر'];

function openSupplierForm(id) {
  const editing = id != null;
  const s = editing ? (_db.students || []).find(x => String(x.id) === String(id)) : null;
  if (editing && !s) return;
  const displayName = s ? `${s.name || ''} ${s.lname || ''}`.trim() : '';
  const cats = [...new Set((_db.students || []).map(x => String(x.supplier_category || '').trim()).filter(Boolean))];
  const terms = String(s?.payment_terms || 'نقدی');
  const rating = Number(s?.supplier_rating) || 0;
  const ratingOpts = [0, 1, 2, 3, 4, 5].map(n =>
    `<option value="${n}" ${rating === n ? 'selected' : ''}>${n ? '★'.repeat(n) : 'بدون امتیاز'}</option>`).join('');
  openModal(editing ? 'ویرایش تامین‌کننده' : 'تامین‌کننده جدید', `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">نام تامین‌کننده *</label>
        <input class="form-input" id="sf-name" placeholder="نام شرکت، فروشگاه یا شخص" value="${escapeHtml(displayName)}">
      </div>
      <div class="form-group">
        <label class="form-label">شخص رابط</label>
        <input class="form-input" id="sf-contact" placeholder="مثلاً آقای رضایی — فروش" value="${escapeHtml(s?.contact_name || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">شماره تماس</label>
        <input class="form-input" id="sf-phone" inputmode="tel" placeholder="09xxxxxxxxx" value="${escapeHtml(s?.phone || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">حوزه تامین</label>
        <input class="form-input" id="sf-category" list="sf-category-list" placeholder="مثلاً مواد اولیه، بسته‌بندی" value="${escapeHtml(s?.supplier_category || '')}">
        <datalist id="sf-category-list">${cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label">شرایط پرداخت</label>
        <select class="form-select" id="sf-terms">${SUPPLIER_PAYMENT_TERMS.map(t => `<option ${terms === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">توضیحات</label>
        <textarea class="form-textarea" id="sf-desc" rows="2" placeholder="آدرس، کالاهای اصلی، شماره حساب یا هر نکته‌ای">${escapeHtml(s?.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">امتیاز همکاری</label>
        <select class="form-select" id="sf-rating">${ratingOpts}</select>
      </div>
      <div class="form-group" style="justify-content:flex-end">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12.5px;color:var(--text2)">
          <input type="checkbox" id="sf-is-client" ${s && _partyRoles(s).is_client ? 'checked' : ''}>
          <span>از من خرید هم می‌کند (مشتری هم هست)</span>
        </label>
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveSupplierForm(${editing ? Number(s.id) : 'null'})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  setTimeout(() => document.getElementById('sf-name')?.focus(), 50);
}

async function saveSupplierForm(id) {
  const name = (document.getElementById('sf-name')?.value || '').trim();
  if (!name) { showToast('نام تامین‌کننده را وارد کنید', 'error'); return; }
  const fields = {
    phone: (document.getElementById('sf-phone')?.value || '').trim(),
    contact_name: (document.getElementById('sf-contact')?.value || '').trim(),
    supplier_category: (document.getElementById('sf-category')?.value || '').trim(),
    payment_terms: document.getElementById('sf-terms')?.value || 'نقدی',
    supplier_rating: Number(document.getElementById('sf-rating')?.value) || 0,
    description: (document.getElementById('sf-desc')?.value || '').trim(),
    is_supplier: true,
    is_client: !!document.getElementById('sf-is-client')?.checked,
  };
  if (id == null) {
    await window.api.students.add({
      name, lname: '', organization_name: '',
      date: typeof _todayJalali === 'function' ? _formatJalali(..._todayJalali()) : '',
      customer_category: '', referral_source: '', relationship_status: '',
      supplier_note: '', packages: [],
      ...fields,
    });
    showToast(`${name} اضافه شد ✓`, 'success');
  } else {
    const s = (_db.students || []).find(x => String(x.id) === String(id));
    if (!s) return;
    // همه فیلدهای دیگر پرونده دست‌نخورده می‌مانند (update بعضی فیلدها را بازنویسی می‌کند)
    await window.api.students.update({
      id: s.id, name, lname: '',
      organization_name: s.organization_name || '',
      date: s.date_jalali || '',
      customer_category: s.customer_category || '',
      referral_source: s.referral_source ?? '',
      relationship_status: s.relationship_status ?? '',
      archive_data: s.archive_data || {},
      note: s.note || '',
      family_id: s.family_id || null,
      supplier_note: s.supplier_note || '',
      packages: [],
      ...fields,
    });
    showToast('تامین‌کننده ذخیره شد ✓', 'success');
  }
  try { if (typeof _syncToServer === 'function') await _syncToServer(); } catch (e) { /* */ }
  closeModal();
  if (currentPage === 'suppliers') await renderSuppliers(currentSuppliersSearch());
  else if (typeof renderPage === 'function') await renderPage();
}