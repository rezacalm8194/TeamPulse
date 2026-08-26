// TeamPulse deferred UI — dashboard, staff, knowledge, tutorial.
// Loaded after first paint (idle) or on first visit to those pages.
// ════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
function toggleTopEarners(button) {
  const section = button?.closest('.detail-section');
  if (!section) return;
  const shouldExpand = button.getAttribute('aria-expanded') !== 'true';
  section.querySelectorAll('[data-top-earner-extra]').forEach(row => {
    row.style.display = shouldExpand ? '' : 'none';
  });
  button.setAttribute('aria-expanded', String(shouldExpand));
  button.textContent = shouldExpand ? 'نمایش کمتر' : 'مشاهده ادامه';
}

function toggleMonthlyIncome(button) {
  const section = button?.closest('.detail-section');
  if (!section) return;
  const shouldExpand = button.getAttribute('aria-expanded') !== 'true';
  section.querySelectorAll('[data-monthly-income-extra]').forEach(row => {
    row.style.display = shouldExpand ? '' : 'none';
  });
  button.setAttribute('aria-expanded', String(shouldExpand));
  button.textContent = shouldExpand ? 'نمایش کمتر' : 'مشاهده ادامه';
}

function changeDashboardIncomeYear(value) {
  window._dashboardIncomeYear = Number(value) || null;
  renderDashboard();
}

function openDashboardIncomeReport() {
  const section = document.getElementById('dashboard-income-report');
  if (!section) return;
  section.scrollIntoView({ behavior:'smooth', block:'start' });
  section.animate(
    [{ boxShadow:'0 0 0 0 rgba(62,207,142,0)' },{ boxShadow:'0 0 0 3px rgba(62,207,142,.38)' },{ boxShadow:'0 0 0 0 rgba(62,207,142,0)' }],
    { duration:900, easing:'ease-out' }
  );
}

function openDashboardFinanceSection(page) {
  if (page === 'payments') window._paymentsTab = 'payments';
  currentPage = page;
  location.hash = page;
  renderPage();
}

function _financialTransactionsFilters() {
  return window._financialTransactionsFilter || (window._financialTransactionsFilter={type:'all',account:'all',year:'all',from:'',to:''});
}
function _financialTransactionRows() {
  const accounts=new Map((_db.financial_accounts||[]).map(a=>[String(a.id),a.name]));
  const staff=new Map((_db.staff||[]).map(s=>[String(s.id),`${s.name||''} ${s.lname||''}`.trim()||'پرسنل']));
  const income=(_db.payments||[]).map(p=>{const customer=(_db.students||[]).find(s=>String(s.id)===String(p.student_id));return{id:`income-${p.id}`,kind:'income',kindLabel:'دریافت مشتری',date:p.date_jalali||'',amount:Number(p.amount||0),currency:p.currency||'تومان',accountId:p.account_id||'',account:accounts.get(String(p.account_id||''))||'—',party:customer?`${customer.name||''} ${customer.lname||''}`.trim():'مشتری',description:p.note||p.method||'دریافت از مشتری'};});
  const salary=(_db.staff_payments||[]).map(p=>({id:`salary-${p.id}`,kind:'salary',kindLabel:'حقوق و پرسنل',date:p.date_jalali||'',amount:Number(p.amount||0),currency:'تومان',accountId:p.account_id||'',account:accounts.get(String(p.account_id||''))||'—',party:staff.get(String(p.staff_id))||'پرسنل',description:p.note||'پرداخت حقوق'}));
  const expense=(_db.expenses||[]).filter(e=>e.source!=='staff_payment').map(e=>({id:`expense-${e.id}`,kind:'expense',kindLabel:'هزینه',date:e.date_jalali||'',amount:Number(e.amount||0),currency:'تومان',accountId:e.account_id||'',account:accounts.get(String(e.account_id||''))||'—',party:e.category||'سایر',description:e.description||e.payment_method||'هزینه'}));
  return [...income,...salary,...expense].sort((a,b)=>_jalaliKey(b.date)-_jalaliKey(a.date));
}
function updateFinancialTransactionsFilters() {
  const filter=_financialTransactionsFilters();
  filter.type=document.getElementById('ft-type')?.value||'all';
  filter.account=document.getElementById('ft-account')?.value||'all';
  filter.year=document.getElementById('ft-year')?.value||'all';
  filter.from=document.getElementById('ft-from')?.value||'';
  filter.to=document.getElementById('ft-to')?.value||'';
  renderFinancialTransactions();
}
function downloadFinancialTransactionsCsv() {
  const f=_financialTransactionsFilters();
  const from=_jalaliKey(f.from),to=_jalaliKey(f.to);
  const rows=_financialTransactionRows().filter(x=>(f.type==='all'||x.kind===f.type)&&(f.account==='all'||String(x.accountId)===String(f.account))&&(f.year==='all'||String(_jalaliParse(x.date)[0])===String(f.year))&&(!from||_jalaliKey(x.date)>=from)&&(!to||_jalaliKey(x.date)<=to));
  const csv=['تاریخ,نوع,طرف حساب,شرح,حساب مالی,مبلغ,واحد پول',...rows.map(x=>[x.date,x.kindLabel,x.party,x.description,x.account,x.amount,x.currency].map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(','))].join('\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='financial-transactions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);
}
async function renderFinancialTransactions() {
  updateTopbarActions('');
  const f=_financialTransactionsFilters();
  const from=_jalaliKey(f.from),to=_jalaliKey(f.to);
  const rows=_financialTransactionRows().filter(x=>(f.type==='all'||x.kind===f.type)&&(f.account==='all'||String(x.accountId)===String(f.account))&&(f.year==='all'||String(_jalaliParse(x.date)[0])===String(f.year))&&(!from||_jalaliKey(x.date)>=from)&&(!to||_jalaliKey(x.date)<=to));
  const income=rows.filter(x=>x.kind==='income'&&x.currency==='تومان').reduce((s,x)=>s+x.amount,0);
  const outgoing=rows.filter(x=>x.kind!=='income').reduce((s,x)=>s+x.amount,0);
  const accountOptions=(_db.financial_accounts||[]).map(a=>`<option value="${a.id}" ${String(f.account)===String(a.id)?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
  const years=[...new Set(_financialTransactionRows().map(x=>_jalaliParse(x.date)[0]).filter(Boolean))].sort((a,b)=>b-a);
  const yearOptions=years.map(y=>`<option value="${y}" ${String(f.year)===String(y)?'selected':''}>${fa(y)}</option>`).join('');
  const kindColor={income:'var(--green)',salary:'var(--amber)',expense:'var(--red)'};
  const html=`<div class="table-card" style="margin-bottom:12px"><div class="table-header"><div><div class="title">📒 تراکنش‌های مالی</div><div class="subtitle">همهٔ دریافت‌ها و پرداخت‌ها در یک نمای واحد</div></div><div style="display:flex;gap:7px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" onclick="openFiscalYearClosing()">🏁 بستن سال مالی</button><button class="btn btn-ghost btn-sm" onclick="downloadFinancialTransactionsCsv()">↓ خروجی اکسل</button></div></div><div class="form-grid" style="padding:0 16px 16px"><div class="form-group"><label class="form-label">سال مالی</label><select class="form-select" id="ft-year" onchange="updateFinancialTransactionsFilters()"><option value="all">همه سال‌ها</option>${yearOptions}</select></div><div class="form-group"><label class="form-label">نوع تراکنش</label><select class="form-select" id="ft-type" onchange="updateFinancialTransactionsFilters()"><option value="all">همه</option><option value="income" ${f.type==='income'?'selected':''}>دریافت مشتری</option><option value="salary" ${f.type==='salary'?'selected':''}>حقوق و پرسنل</option><option value="expense" ${f.type==='expense'?'selected':''}>هزینه</option></select></div><div class="form-group"><label class="form-label">حساب مالی</label><select class="form-select" id="ft-account" onchange="updateFinancialTransactionsFilters()"><option value="all">همه حساب‌ها</option>${accountOptions}</select></div><div class="form-group"><label class="form-label">از تاریخ</label><input class="form-input jdate" id="ft-from" value="${escapeHtml(f.from)}" onchange="updateFinancialTransactionsFilters()" placeholder="۱۴۰۵/۰۱/۰۱"></div><div class="form-group"><label class="form-label">تا تاریخ</label><input class="form-input jdate" id="ft-to" value="${escapeHtml(f.to)}" onchange="updateFinancialTransactionsFilters()" placeholder="۱۴۰۵/۱۲/۲۹"></div></div></div><div class="stats-row" style="margin-bottom:12px"><div class="stat-card s-green"><div class="stat-label">ورود وجه</div><div class="stat-value">${fmt(income)}</div><div class="stat-sub">تومان · نتایج فیلترشده</div></div><div class="stat-card s-red"><div class="stat-label">خروج وجه</div><div class="stat-value">${fmt(outgoing)}</div><div class="stat-sub">تومان · هزینه و حقوق</div></div><div class="stat-card"><div class="stat-label">خالص جریان نقدی</div><div class="stat-value" style="color:${income-outgoing>=0?'var(--green)':'var(--red)'}">${fmt(income-outgoing)}</div><div class="stat-sub">تومان</div></div></div><div class="table-card tbl-responsive"><div class="table-header"><span class="title">${fa(rows.length)} تراکنش</span></div><table><thead><tr><th>تاریخ</th><th>نوع</th><th>طرف حساب</th><th>شرح</th><th>حساب مالی</th><th>مبلغ</th></tr></thead><tbody>${rows.length?rows.map(x=>`<tr><td data-label="تاریخ">${DateService.disp(x.date)||'—'}</td><td data-label="نوع"><span class="tag" style="color:${kindColor[x.kind]};background:color-mix(in srgb, ${kindColor[x.kind]} 15%, transparent)">${x.kindLabel}</span></td><td data-label="طرف حساب">${escapeHtml(x.party)}</td><td data-label="شرح" style="color:var(--text2);font-size:11px">${escapeHtml(x.description)}</td><td data-label="حساب مالی" style="color:${x.accountId?'var(--accent2)':'var(--text3)'}">${escapeHtml(x.account)}</td><td data-label="مبلغ" style="font-weight:800;color:${x.kind==='income'?'var(--green)':'var(--red)'}">${x.kind==='income'?'+':'-'}${fmt(x.amount)} <small>${escapeHtml(x.currency)}</small></td></tr>`).join(''):`<tr><td colspan="6"><div class="empty"><span>📒</span>تراکنشی با این فیلتر پیدا نشد</div></td></tr>`}</tbody></table></div>`;
  setContent(html);initDatePickers();
}

function _fiscalYearReport(year) {
  const rows=_financialTransactionRows().filter(x=>Number(_jalaliParse(x.date)[0])===Number(year));
  const income=rows.filter(x=>x.kind==='income'&&x.currency==='تومان').reduce((s,x)=>s+x.amount,0);
  const salaries=rows.filter(x=>x.kind==='salary').reduce((s,x)=>s+x.amount,0);
  const expenses=rows.filter(x=>x.kind==='expense').reduce((s,x)=>s+x.amount,0);
  const byCategory={};
  (_db.expenses||[]).filter(e=>Number(_jalaliParse(e.date_jalali)[0])===Number(year)).forEach(e=>{const k=e.category||'سایر';byCategory[k]=(byCategory[k]||0)+Number(e.amount||0);});
  const topCategory=Object.entries(byCategory).sort((a,b)=>b[1]-a[1])[0]||null;
  const receivables=(_db.students||[]).reduce((s,x)=>s+Math.max(0,Number(x.balance||0)),0);
  const unpaidStaff=(_db.staff_monthly||[]).filter(x=>!x.paid).reduce((s,x)=>s+Number(x.total||0),0);
  return {year,rows:rows.length,income,salaries,expenses,outgoing:salaries+expenses,profit:income-salaries-expenses,receivables,unpaidStaff,topCategory};
}
function openFiscalYearClosing(year=null) {
  const available=[...new Set(_financialTransactionRows().map(x=>_jalaliParse(x.date)[0]).filter(Boolean))].sort((a,b)=>b-a);
  const selected=Number(year||_financialTransactionsFilters().year||available[0]||_todayJalali()[0]);
  const report=_fiscalYearReport(selected);
  _db.fiscal_year_closings=_db.fiscal_year_closings||[];
  const closing=_db.fiscal_year_closings.find(x=>Number(x.year)===selected&&x.closed!==false);
  const opts=available.length?available.map(y=>`<option value="${y}" ${Number(y)===selected?'selected':''}>${fa(y)}</option>`).join(''):`<option value="${selected}">${fa(selected)}</option>`;
  const status=closing?`<div style="padding:10px 12px;border-radius:10px;background:rgba(62,207,142,.11);color:var(--green);font-size:12px;margin-bottom:12px">✓ گزارش سال ${fa(selected)} در ${DateService.disp(closing.closed_date||'')} بسته و ثبت شده است.</div>`:`<div style="padding:10px 12px;border-radius:10px;background:rgba(251,191,36,.10);color:var(--amber);font-size:12px;margin-bottom:12px">این عمل یک تصویر ثابت از گزارش سال ثبت می‌کند و داده‌های تراکنش را حذف نمی‌کند.</div>`;
  const content=`<div class="form-group"><label class="form-label">سال مالی</label><select class="form-select" id="fy-year" onchange="openFiscalYearClosing(this.value)">${opts}</select></div>${status}<div class="stats-row" style="margin:12px 0"><div class="stat-card s-green"><div class="stat-label">درآمد واقعی</div><div class="stat-value">${fmt(report.income)}</div><div class="stat-sub">تومان · دریافت مشتریان</div></div><div class="stat-card s-red"><div class="stat-label">هزینه و حقوق</div><div class="stat-value">${fmt(report.outgoing)}</div><div class="stat-sub">تومان</div></div><div class="stat-card"><div class="stat-label">سود نقدی</div><div class="stat-value" style="color:${report.profit>=0?'var(--green)':'var(--red)'}">${fmt(report.profit)}</div><div class="stat-sub">تومان</div></div></div><div class="detail-section"><div class="detail-row"><span class="detail-key">تعداد تراکنش‌های سال</span><span class="detail-val">${fa(report.rows)}</span></div><div class="detail-row"><span class="detail-key">بیشترین دسته هزینه</span><span class="detail-val">${report.topCategory?`${escapeHtml(report.topCategory[0])} · ${fmt(report.topCategory[1])} تومان`:'—'}</span></div><div class="detail-row"><span class="detail-key">مطالبات باز فعلی مشتریان</span><span class="detail-val amount-debt">${fmt(report.receivables)} تومان</span></div><div class="detail-row"><span class="detail-key">تعهدات پرداخت‌نشده پرسنل</span><span class="detail-val amount-debt">${fmt(report.unpaidStaff)} تومان</span></div></div><div class="form-group" style="margin-top:12px"><label class="form-label">یادداشت مدیریتی سال</label><textarea class="form-input" id="fy-note" rows="3" placeholder="مثلاً: تمرکز سال بعد روی کاهش هزینه تبلیغات">${escapeHtml(closing?.note||'')}</textarea></div>`;
  const actions=closing?[{label:'بازگشایی گزارش',cls:'btn-ghost',action:`reopenFiscalYear(${selected})`},{label:'بستن',cls:'btn-primary',action:'closeModal()'}]:[{label:'ثبت و بستن سال',cls:'btn-primary',action:`confirmFiscalYearClosing(${selected})`},{label:'انصراف',cls:'btn-ghost',action:'closeModal()'}];
  openModal(`🏁 بستن سال مالی ${fa(selected)}`,content,actions,{fullPage:true});
}
function confirmFiscalYearClosing(year) {
  if(!confirm(`گزارش سال مالی ${fa(year)} ثبت و بسته شود؟`))return;
  _db.fiscal_year_closings=_db.fiscal_year_closings||[];
  const snapshot={..._fiscalYearReport(year),created_at:new Date().toISOString()};
  const existing=_db.fiscal_year_closings.find(x=>Number(x.year)===Number(year));
  const record={year:Number(year),closed:true,closed_date:_formatJalali(..._todayJalali()),note:(document.getElementById('fy-note')?.value||'').trim(),snapshot,updated_at:new Date().toISOString()};
  if(existing)Object.assign(existing,record);else _db.fiscal_year_closings.push({id:_nextId('fiscal_year_closings'),...record,created_at:new Date().toISOString()});
  _save();closeModal();showToast(`سال مالی ${fa(year)} بسته شد ✓`,'success');
  if(currentPage==='transactions')renderFinancialTransactions();
}
function reopenFiscalYear(year) {
  const record=(_db.fiscal_year_closings||[]).find(x=>Number(x.year)===Number(year));
  if(!record)return;
  record.closed=false;record.reopened_at=new Date().toISOString();record.updated_at=new Date().toISOString();_save();showToast(`گزارش سال ${fa(year)} بازگشایی شد`,'success');openFiscalYearClosing(year);
}

function _budgetFor(year, month=0) { return (_db.financial_budgets||[]).find(b=>Number(b.year)===Number(year)&&Number(b.month||0)===Number(month||0)); }
function _budgetActual(year, month=0) {
  const match=date=>{const[y,m]=_jalaliParse(date);return Number(y)===Number(year)&&(!month||Number(m)===Number(month));};
  const income=(_db.payments||[]).filter(p=>(p.currency||'تومان')==='تومان'&&match(p.date_jalali)).reduce((s,p)=>s+Number(p.amount||0),0);
  const expenses=(_db.expenses||[]).filter(e=>match(e.date_jalali)).reduce((s,e)=>s+Number(e.amount||0),0);
  const categories={};(_db.expenses||[]).filter(e=>match(e.date_jalali)).forEach(e=>{const k=e.category||'سایر';categories[k]=(categories[k]||0)+Number(e.amount||0);});
  return {income,expenses,profit:income-expenses,categories};
}
function _budgetProgress(value,target) { return target>0?Math.round(value/target*100):0; }
function _budgetBar(value,target,color='var(--accent)') { const p=Math.min(100,_budgetProgress(value,target));return `<div style="height:7px;border-radius:99px;background:var(--bg3);overflow:hidden;margin-top:6px"><span style="display:block;height:100%;width:${p}%;background:${color};border-radius:99px"></span></div>`; }
function _budgetCategoryFields(limits={}) { return EXPENSE_CATEGORIES.map(c=>`<div class="form-group"><label class="form-label">سقف ${c}</label><input class="form-input amount-input" data-budget-category="${c}" inputmode="numeric" value="${limits[c]?fmt(limits[c]):''}" placeholder="بدون سقف"></div>`).join(''); }
function openBudgetManager() {
  _db.financial_budgets=_db.financial_budgets||[];
  const rows=[..._db.financial_budgets].sort((a,b)=>Number(b.year)*100+Number(b.month||0)-(Number(a.year)*100+Number(a.month||0)));
  const monthNames=['','فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const header='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px"><div style="font-size:11px;color:var(--text3)">هدف درآمد، سقف هزینه و سقف دسته‌ها را برای کنترل مالی تعیین کنید.</div><button class="btn btn-primary btn-sm" onclick="openBudgetForm()">+ بودجه جدید</button></div>';
  const cards=rows.map(b=>{const a=_budgetActual(b.year,b.month);const label=b.month?`${monthNames[b.month]} ${fa(b.year)}`:`سال ${fa(b.year)}`;const profitColor=a.profit>=0?'var(--green)':'var(--red)';return `<div style="padding:12px;border:1px solid var(--border2);border-radius:12px;background:var(--bg3)"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${label}</b><div style="display:flex;gap:5px"><button class="btn btn-ghost btn-sm" onclick="openBudgetForm(${b.id})">ویرایش</button><button class="btn btn-danger btn-sm" onclick="deleteFinancialBudget(${b.id})">حذف</button></div></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:10px;font-size:11px"><div>درآمد: <b style="color:var(--green)">${fmt(a.income)} / ${fmt(b.income_target||0)}</b>${_budgetBar(a.income,b.income_target,'var(--green)')}</div><div>هزینه: <b style="color:var(--red)">${fmt(a.expenses)} / ${fmt(b.expense_limit||0)}</b>${_budgetBar(a.expenses,b.expense_limit,'var(--red)')}</div><div>سود: <b style="color:${profitColor}">${fmt(a.profit)} / ${fmt(b.profit_target||0)}</b>${_budgetBar(a.profit,b.profit_target,'var(--accent)')}</div></div></div>`;}).join('');
  const html=header+(cards?`<div style="display:flex;flex-direction:column;gap:8px">${cards}</div>`:'<div style="text-align:center;color:var(--text3);padding:30px">هنوز بودجه‌ای تعریف نشده است.</div>');
  openModal('🎯 بودجه و هدف مالی',html,[{label:'بستن',cls:'btn-ghost',action:'closeModal()'}],{fullPage:true});
}
function openBudgetForm(id=null) {
  const b=id==null?{}:(_db.financial_budgets||[]).find(x=>Number(x.id)===Number(id))||{};
  const[year,month]=_todayJalali();const months=['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const html=`<div class="form-grid"><div class="form-group"><label class="form-label">سال</label><input class="form-input" id="budget-year" type="number" value="${b.year||year}"></div><div class="form-group"><label class="form-label">دوره</label><select class="form-select" id="budget-month"><option value="0" ${!b.month?'selected':''}>بودجه سالانه</option>${months.map((n,i)=>`<option value="${i+1}" ${Number(b.month)===i+1?'selected':''}>${n}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">هدف درآمد (تومان)</label><input class="form-input amount-input" id="budget-income" inputmode="numeric" value="${b.income_target?fmt(b.income_target):''}"></div><div class="form-group"><label class="form-label">سقف هزینه کل (تومان)</label><input class="form-input amount-input" id="budget-expense" inputmode="numeric" value="${b.expense_limit?fmt(b.expense_limit):''}"></div><div class="form-group full"><label class="form-label">هدف سود نقدی (تومان)</label><input class="form-input amount-input" id="budget-profit" inputmode="numeric" value="${b.profit_target?fmt(b.profit_target):''}"></div><div class="form-group full"><label class="form-label">سقف هزینه بر اساس دسته (اختیاری)</label><div class="form-grid" style="margin-top:8px">${_budgetCategoryFields(b.category_limits||{})}</div></div></div>`;
  openModal(id==null?'🎯 بودجه جدید':'✏️ ویرایش بودجه',html,[{label:'ذخیره',cls:'btn-primary',action:`saveFinancialBudget(${id==null?'null':Number(id)})`},{label:'انصراف',cls:'btn-ghost',action:'openBudgetManager()'}],{fullPage:true});
}
function saveFinancialBudget(id=null) {
  const year=Number(document.getElementById('budget-year')?.value),month=Number(document.getElementById('budget-month')?.value||0);
  if(!year||year<1300){showToast('سال مالی معتبر وارد کنید','error');return;}
  const limits={};document.querySelectorAll('[data-budget-category]').forEach(el=>{const v=_expenseAmountValue(el.value);if(v>0)limits[el.dataset.budgetCategory]=v;});
  const data={year,month,income_target:_expenseAmountValue(document.getElementById('budget-income')?.value),expense_limit:_expenseAmountValue(document.getElementById('budget-expense')?.value),profit_target:_expenseAmountValue(document.getElementById('budget-profit')?.value),category_limits:limits,updated_at:new Date().toISOString()};
  _db.financial_budgets=_db.financial_budgets||[];const duplicate=_db.financial_budgets.find(b=>Number(b.year)===year&&Number(b.month||0)===month&&Number(b.id)!==Number(id));
  if(duplicate){Object.assign(duplicate,data);showToast('بودجه همان دوره به‌روزرسانی شد ✓','success');}else if(id==null){_db.financial_budgets.push({id:_nextId('financial_budgets'),...data,created_at:new Date().toISOString()});showToast('بودجه ذخیره شد ✓','success');}else{const b=_db.financial_budgets.find(x=>Number(x.id)===Number(id));if(b)Object.assign(b,data);}
  _save();openBudgetManager();if(currentPage==='dashboard')renderDashboard();
}
function deleteFinancialBudget(id) { if(!confirm('این بودجه حذف شود؟'))return;_db.financial_budgets=(_db.financial_budgets||[]).filter(b=>Number(b.id)!==Number(id));_save();openBudgetManager(); }
function budgetDashboardHtml(year,month) { const b=_budgetFor(year,month);if(!b)return `<div class="detail-section"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><h3 style="margin:0">🎯 بودجه ماه</h3><p style="font-size:11px;color:var(--text3);margin:5px 0 0">برای این ماه هنوز بودجه‌ای ثبت نشده است.</p></div><button class="btn btn-ghost btn-sm" onclick="openBudgetForm()">تعریف بودجه</button></div></div>`;const a=_budgetActual(year,month);const alerts=[];if(b.expense_limit&&a.expenses>=b.expense_limit)alerts.push('سقف هزینه کل رد شده');else if(b.expense_limit&&a.expenses/b.expense_limit>=.8)alerts.push('هزینه به ۸۰٪ سقف رسیده');Object.entries(b.category_limits||{}).forEach(([c,l])=>{if((a.categories[c]||0)>=l)alerts.push(`سقف ${c} رد شده`);});return `<div class="detail-section"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><h3 style="margin:0">🎯 بودجه ${fa(year)}/${fa(month)}</h3><button class="btn btn-ghost btn-sm" onclick="openBudgetManager()">مدیریت</button></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px;font-size:11px"><div>درآمد ${fmt(a.income)} / ${fmt(b.income_target)}${_budgetBar(a.income,b.income_target,'var(--green)')}</div><div>هزینه ${fmt(a.expenses)} / ${fmt(b.expense_limit)}${_budgetBar(a.expenses,b.expense_limit,'var(--red)')}</div><div>سود ${fmt(a.profit)} / ${fmt(b.profit_target)}${_budgetBar(a.profit,b.profit_target,'var(--accent)')}</div></div>${alerts.length?`<div style="font-size:11px;color:var(--amber);margin-top:10px">⚠️ ${alerts.join(' · ')}</div>`:''}</div>`; }

function _cashForecast(days=30) {
  const incoming=(_db.reminders||[]).filter(r=>!r.done).map(r=>{const dueIn=_daysUntil(r.due_date_jalali||'');const s=(_db.students||[]).find(x=>String(x.id)===String(r.student_id));return {kind:'in',dueIn,date:r.due_date_jalali||'',amount:Number(r.amount||0),name:`${s?.name||'مشتری'} ${s?.lname||''}`.trim(),title:r.title||'دریافت مشتری'};}).filter(x=>x.dueIn<=days);
  const outgoing=(_db.staff_reminders||[]).filter(r=>!r.done).map(r=>{const dueIn=_daysUntil(r.due_date_jalali||'');const s=(_db.staff||[]).find(x=>String(x.id)===String(r.staff_id));return {kind:'out',dueIn,date:r.due_date_jalali||'',amount:Number(r.amount||0),name:`${s?.name||'پرسنل'} ${s?.lname||''}`.trim(),title:r.title||'پرداخت پرسنل'};}).filter(x=>x.dueIn<=days);
  const sort=(a,b)=>a.dueIn-b.dueIn;incoming.sort(sort);outgoing.sort(sort);
  const totalIn=incoming.reduce((s,x)=>s+x.amount,0),totalOut=outgoing.reduce((s,x)=>s+x.amount,0);
  const cash=(_db.financial_accounts||[]).reduce((s,a)=>s+Number(_financialAccountBalance(a)||0),0);
  const timeline=[...incoming,...outgoing].sort(sort);let running=cash,lowest={amount:cash,item:null};timeline.forEach(x=>{running+=x.kind==='in'?x.amount:-x.amount;if(running<lowest.amount)lowest={amount:running,item:x};});
  return {days,incoming,outgoing,totalIn,totalOut,net:totalIn-totalOut,cash,ending:cash+totalIn-totalOut,lowest};
}
function _forecastDueLabel(days) { return days<0?`${fa(Math.abs(days))} روز عقب‌افتاده`:days===0?'امروز':`${fa(days)} روز دیگر`; }
function cashForecastDashboardHtml() { const f=_cashForecast(30);const risk=f.lowest.amount<0;const headline=risk?`⚠️ احتمال کسری ${fmt(Math.abs(f.lowest.amount))} تومان${f.lowest.item?` تا ${_forecastDueLabel(f.lowest.item.dueIn)}`:''}`:`✓ مانده پیش‌بینی‌شده تا ۳۰ روز آینده: ${fmt(f.ending)} تومان`;return `<div class="detail-section" style="margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><h3 style="margin:0">🔮 پیش‌بینی جریان نقدی ۳۰ روز آینده</h3><div style="font-size:10px;color:var(--text3);margin-top:4px">بر پایه سررسیدهای ثبت‌شدهٔ مشتریان و پرسنل</div></div><button class="btn btn-ghost btn-sm" onclick="openCashForecast()">جزئیات</button></div><div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px;font-size:11px"><div>ورودی پیش‌بینی‌شده <b style="display:block;color:var(--green);margin-top:4px">${fmt(f.totalIn)}</b></div><div>خروجی پیش‌بینی‌شده <b style="display:block;color:var(--red);margin-top:4px">${fmt(f.totalOut)}</b></div><div>مانده حساب‌ها <b style="display:block;color:var(--accent2);margin-top:4px">${fmt(f.cash)}</b></div></div><div style="font-size:11px;color:${risk?'var(--red)':'var(--green)'};margin-top:11px">${headline}</div></div>`; }
function openCashForecast() { const f=_cashForecast(30);const renderList=(list,empty,color)=>list.length?`<div style="display:flex;flex-direction:column;gap:7px">${list.map(x=>`<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)"><div><b style="font-size:12px">${escapeHtml(x.name)}</b><div style="font-size:10px;color:var(--text3);margin-top:2px">${escapeHtml(x.title)} · ${DateService.disp(x.date)} · ${_forecastDueLabel(x.dueIn)}</div></div><b style="color:${color};white-space:nowrap">${fmt(x.amount)} ت</b></div>`).join('')}</div>`:`<div style="color:var(--text3);font-size:12px;padding:12px 0">${empty}</div>`;const content=`<div class="stats-row" style="margin-bottom:14px"><div class="stat-card"><div class="stat-label">مانده فعلی حساب‌ها</div><div class="stat-value">${fmt(f.cash)}</div><div class="stat-sub">تومان</div></div><div class="stat-card s-green"><div class="stat-label">ورودی تا ۳۰ روز</div><div class="stat-value">${fmt(f.totalIn)}</div><div class="stat-sub">تومان</div></div><div class="stat-card s-red"><div class="stat-label">خروجی تا ۳۰ روز</div><div class="stat-value">${fmt(f.totalOut)}</div><div class="stat-sub">تومان</div></div></div><div class="detail-section"><h3>📥 دریافت‌های پیش‌بینی‌شده</h3>${renderList(f.incoming,'سررسید دریافت ثبت‌شده‌ای در ۳۰ روز آینده نیست.','var(--green)')}</div><div class="detail-section"><h3>📤 پرداخت‌های پیش‌بینی‌شده</h3>${renderList(f.outgoing,'سررسید پرداخت پرسنلی در ۳۰ روز آینده نیست.','var(--red)')}</div><div style="padding:11px;border-radius:10px;background:${f.lowest.amount<0?'rgba(248,113,113,.11)':'rgba(62,207,142,.10)'};color:${f.lowest.amount<0?'var(--red)':'var(--green)'};font-size:12px">${f.lowest.amount<0?`کسری احتمالی: ${fmt(Math.abs(f.lowest.amount))} تومان`:`پس از سررسیدهای ثبت‌شده، کسری نقدینگی پیش‌بینی نمی‌شود.`}</div>`;openModal('🔮 پیش‌بینی جریان نقدی',content,[{label:'بستن',cls:'btn-ghost',action:'closeModal()'}],{fullPage:true}); }

async function openDashboardCustomerAccount(id) {
  currentPage='customerlist'; location.hash='customerlist';
  await renderPage();
  await openStudentDetail(id);
}

async function openDashboardStaffAccount(id) {
  currentPage='staff'; location.hash='staff';
  await renderPage();
  await openStaffDetail(id);
}

const EXPENSE_CATEGORIES = ['اجاره','حقوق و دستمزد','تبلیغات','تجهیزات','نرم‌افزار و اشتراک','حمل‌ونقل','پذیرایی','مالیات و بیمه','آموزش','سایر'];
const EXPENSE_PAYMENT_METHODS = ['کارت','انتقال بانکی','نقدی','چک','کیف پول','سایر'];
window._pendingExpenseReceipts = window._pendingExpenseReceipts || [];

function _expenseAmountValue(value) {
  return Math.max(0, Number(enDigits(String(value||'').replace(/[,٬،\s]/g,''))) || 0);
}

const FINANCIAL_ACCOUNT_TYPES = { cash:'نقد', bank:'حساب بانکی', pos:'کارت‌خوان', wallet:'کیف پول', other:'سایر' };
function financialAccountOptionsHtml(selectedId=null, emptyLabel='بدون اتصال به حساب') {
  const accounts=_db.financial_accounts||[];
  return `<option value="">${emptyLabel}</option>${accounts.map(a=>`<option value="${a.id}" ${String(a.id)===String(selectedId||'')?'selected':''}>${escapeHtml(a.name)} · ${FINANCIAL_ACCOUNT_TYPES[a.type]||'سایر'}</option>`).join('')}`;
}
function _financialAccountBalance(account) {
  const id=String(account.id);
  const received=(_db.payments||[]).filter(p=>String(p.account_id||'')===id&&(p.currency||'تومان')==='تومان').reduce((sum,p)=>sum+Number(p.amount||0),0);
  const spent=(_db.expenses||[]).filter(e=>String(e.account_id||'')===id).reduce((sum,e)=>sum+Number(e.amount||0),0);
  return Number(account.opening_balance||0)+received-spent;
}
function _syncStaffPaymentExpense(payment) {
  if (!payment) return null;
  _db.expenses = _db.expenses || [];
  const staff = (_db.staff||[]).find(s=>String(s.id)===String(payment.staff_id));
  const title = `حقوق و دستمزد — ${[staff?.name,staff?.lname].filter(Boolean).join(' ')||'پرسنل'}`;
  let expense = payment.expense_id && _db.expenses.find(e=>String(e.id)===String(payment.expense_id));
  const data = {amount:Number(payment.amount||0),date_jalali:payment.date_jalali||'',category:'حقوق و دستمزد',payment_method:'پرداخت پرسنل',account_id:payment.account_id||null,description:payment.note||title,source:'staff_payment',staff_payment_id:payment.id,updated_at:new Date().toISOString()};
  if (expense) Object.assign(expense,data);
  else { expense={id:_nextId('expenses'),...data,created_at:new Date().toISOString()};_db.expenses.push(expense);payment.expense_id=expense.id; }
  return expense;
}
function _removeStaffPaymentExpense(payment) {
  if (!payment?.expense_id) return;
  _db.expenses=(_db.expenses||[]).filter(e=>String(e.id)!==String(payment.expense_id));
}
function openFinancialAccounts() {
  const accounts=(_db.financial_accounts||[]).slice();
  const cards=accounts.map(a=>`<div style="padding:13px;border:1px solid var(--border2);border-radius:12px;background:var(--bg3)"><div style="font-size:12px;color:var(--text2)">${escapeHtml(a.name)} · ${FINANCIAL_ACCOUNT_TYPES[a.type]||'سایر'}</div><div style="font-size:18px;font-weight:800;color:var(--green);margin:7px 0">${fmt(_financialAccountBalance(a))}</div><div style="font-size:10px;color:var(--text3)">موجودی فعلی (تومان)</div><div style="display:flex;gap:5px;margin-top:10px"><button class="btn btn-ghost btn-sm" onclick="openFinancialAccountForm(${a.id})">ویرایش</button><button class="btn btn-danger btn-sm" onclick="deleteFinancialAccount(${a.id})">حذف</button></div></div>`).join('');
  const list=accounts.length
    ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">${cards}</div>`
    : '<div style="text-align:center;padding:28px;color:var(--text3)">حسابی ثبت نشده است. با ثبت نقد، بانک یا کارت‌خوان شروع کنید.</div>';
  const header='<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px"><div style="font-size:11px;color:var(--text3)">مانده فقط از تراکنش‌های متصل به حساب محاسبه می‌شود</div><button class="btn btn-primary btn-sm" onclick="openFinancialAccountForm()">+ حساب جدید</button></div>';
  openModal('🏦 حساب‌های مالی',header+list,[{label:'بستن',cls:'btn-ghost',action:'closeModal()'}]);
}
function openFinancialAccountForm(id=null) {
  const a=id==null?{}:(_db.financial_accounts||[]).find(a=>String(a.id)===String(id))||{};
  openModal(id==null?'➕ حساب مالی جدید':'✏️ ویرایش حساب مالی',`<div class="form-grid"><div class="form-group"><label class="form-label">نام حساب *</label><input class="form-input" id="fa-name" value="${escapeHtml(a.name||'')}" placeholder="مثلاً: کارت‌خوان فروشگاه"></div><div class="form-group"><label class="form-label">نوع</label><select class="form-select" id="fa-type">${Object.entries(FINANCIAL_ACCOUNT_TYPES).map(([key,label])=>`<option value="${key}" ${a.type===key?'selected':''}>${label}</option>`).join('')}</select></div><div class="form-group full"><label class="form-label">موجودی اولیه (تومان)</label><input class="form-input amount-input" id="fa-opening" inputmode="numeric" value="${a.opening_balance?fmt(a.opening_balance):''}" placeholder="برای شروع مانده فعلی حساب را وارد کنید"></div></div>`,[{label:'ذخیره',cls:'btn-primary',action:`saveFinancialAccount(${id==null?'null':Number(id)})`},{label:'انصراف',cls:'btn-ghost',action:'openFinancialAccounts()'}]);
}
function saveFinancialAccount(id=null) {
  const name=(document.getElementById('fa-name')?.value||'').trim();
  if(!name){showToast('نام حساب را وارد کنید','error');return;}
  const data={name,type:document.getElementById('fa-type')?.value||'other',opening_balance:_expenseAmountValue(document.getElementById('fa-opening')?.value)};
  if(id==null){const item={id:_db._nextId.financial_accounts++,...data,created_at:new Date().toISOString()};_db.financial_accounts.push(item);}else{const item=(_db.financial_accounts||[]).find(a=>String(a.id)===String(id));if(item)Object.assign(item,data);}
  _save();showToast('حساب مالی ذخیره شد ✓','success');openFinancialAccounts();
}
function deleteFinancialAccount(id) {
  const used=(_db.payments||[]).some(p=>String(p.account_id||'')===String(id))||(_db.expenses||[]).some(e=>String(e.account_id||'')===String(id));
  if(used){showToast('این حساب به تراکنش‌ها متصل است و قابل حذف نیست','error');return;}
  if(!confirm('این حساب حذف شود؟'))return;
  _db.financial_accounts=_db.financial_accounts.filter(a=>String(a.id)!==String(id));_save();openFinancialAccounts();
}

function _expenseRepeatLabel(months) {
  const n=Number(months||0);
  return n===1?'هر ماه':n===2?'هر ۲ ماه':n===3?'هر ۳ ماه':n===6?'هر ۶ ماه':n===12?'سالانه':n?`هر ${n} ماه`:'یک‌بار';
}
function toggleExpenseRepeatOptions() {
  const enabled=!!document.getElementById('expense-recurring')?.checked;
  const options=document.getElementById('expense-repeat-options');
  if(options)options.style.display=enabled?'grid':'none';
}
function _expenseFormHtml(expense={}) {
  const today = _formatJalali(..._todayJalali());
  return `<div class="form-grid">
    <div class="form-group"><label class="form-label">مبلغ (تومان) *</label><input class="form-input amount-input" id="expense-amount" inputmode="numeric" value="${expense.amount?fmt(expense.amount):''}" placeholder="مثلاً ۷۲,۰۰۰,۰۰۰"></div>
    <div class="form-group"><label class="form-label">تاریخ *</label><input class="form-input jdate" id="expense-date" value="${escapeHtml(expense.date_jalali||today)}" placeholder="۱۴۰۵/۰۵/۲۲"></div>
    <div class="form-group"><label class="form-label">دسته‌بندی *</label><select class="form-select" id="expense-category">${EXPENSE_CATEGORIES.map(c=>`<option ${expense.category===c?'selected':''}>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">روش پرداخت</label><select class="form-select" id="expense-method">${EXPENSE_PAYMENT_METHODS.map(m=>`<option ${expense.payment_method===m?'selected':''}>${m}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">پرداخت از حساب</label><select class="form-select" id="expense-account">${financialAccountOptionsHtml(expense.account_id)}</select></div>
    <div class="form-group full" style="border:1px solid var(--border2);border-radius:12px;padding:12px;background:var(--bg3)"><label style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;cursor:pointer"><input type="checkbox" id="expense-recurring" ${Number(expense.repeat_months||0)>0?'checked':''} onchange="toggleExpenseRepeatOptions()"> 🔁 هزینه تکرارشونده است</label><div id="expense-repeat-options" style="display:${Number(expense.repeat_months||0)>0?'grid':'none'};grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px"><div><label class="form-label">تکرار</label><select class="form-select" id="expense-repeat-months"><option value="1" ${Number(expense.repeat_months||0)===1?'selected':''}>هر ماه</option><option value="2" ${Number(expense.repeat_months||0)===2?'selected':''}>هر ۲ ماه</option><option value="3" ${Number(expense.repeat_months||0)===3?'selected':''}>هر ۳ ماه</option><option value="6" ${Number(expense.repeat_months||0)===6?'selected':''}>هر ۶ ماه</option><option value="12" ${Number(expense.repeat_months||0)===12?'selected':''}>سالانه</option></select></div><div><label class="form-label">یادآوری پیش از سررسید</label><select class="form-select" id="expense-reminder-days"><option value="0" ${Number(expense.reminder_days||3)===0?'selected':''}>همان روز</option><option value="1" ${Number(expense.reminder_days||3)===1?'selected':''}>۱ روز قبل</option><option value="3" ${Number(expense.reminder_days||3)===3?'selected':''}>۳ روز قبل</option><option value="7" ${Number(expense.reminder_days||3)===7?'selected':''}>۷ روز قبل</option></select></div><div style="grid-column:1/-1;font-size:11px;color:var(--text3)">برای نوبت بعدی هزینه، در بخش پیگیری‌های مالی یادآوری دریافت می‌کنید.</div></div></div>
    <div class="form-group full"><label class="form-label">شرح</label><textarea class="form-textarea" id="expense-description" rows="3" placeholder="این هزینه بابت چه چیزی بوده است؟">${escapeHtml(expense.description||'')}</textarea></div>
    <div class="form-group full"><label class="form-label">تصویر رسید (اختیاری)</label><button type="button" class="btn btn-ghost" onclick="addExpenseReceipt()">📎 افزودن رسید</button><div id="expense-receipts">${renderAttachmentsGrid(window._pendingExpenseReceipts, `(fid)=>removePendingExpenseReceipt(fid)`)}</div></div>
  </div>`;
}

function openExpenseForm(id=null) {
  const expense = id==null ? {} : (_db.expenses||[]).find(e=>String(e.id)===String(id)) || {};
  window._editingExpenseId = id;
  window._pendingExpenseReceipts = _cloneData(expense.receipts||[]);
  openModal(id==null?'➕ ثبت هزینه جدید':'✏️ ویرایش هزینه',_expenseFormHtml(expense),[
    {label:'ذخیره هزینه',cls:'btn-primary',action:'saveExpense()'},
    {label:'انصراف',cls:'btn-ghost',action:'openExpenseManager()'}
  ]);
  initDatePickers();
}

async function addExpenseReceipt() {
  window._pendingExpenseReceipts = await attachFiles('expense',window._editingExpenseId,window._pendingExpenseReceipts||[]);
  const el=document.getElementById('expense-receipts');
  if(el)el.innerHTML=renderAttachmentsGrid(window._pendingExpenseReceipts,`(fid)=>removePendingExpenseReceipt(fid)`);
}

async function removePendingExpenseReceipt(id) {
  window._pendingExpenseReceipts=(window._pendingExpenseReceipts||[]).filter(a=>a.id!==id);
  try{await _IDB.delete(id);}catch(e){}
  const el=document.getElementById('expense-receipts');
  if(el)el.innerHTML=renderAttachmentsGrid(window._pendingExpenseReceipts,`(fid)=>removePendingExpenseReceipt(fid)`);
}

function saveExpense() {
  const amount=_expenseAmountValue(document.getElementById('expense-amount')?.value);
  const date=(document.getElementById('expense-date')?.value||'').trim();
  if(!amount){showToast('مبلغ هزینه را وارد کنید','error');return;}
  if(!_jalaliKey(date)){showToast('تاریخ هزینه معتبر نیست','error');return;}
  const id=window._editingExpenseId;
  const expense=id==null?{id:_db._nextId.expenses++,created_at:new Date().toISOString()}:(_db.expenses||[]).find(e=>String(e.id)===String(id));
  if(!expense){showToast('هزینه پیدا نشد','error');return;}
  const repeatMonths=document.getElementById('expense-recurring')?.checked?Number(document.getElementById('expense-repeat-months')?.value||1):0;
  const reminderDays=repeatMonths?Number(document.getElementById('expense-reminder-days')?.value||0):0;
  Object.assign(expense,{amount,date_jalali:date,category:document.getElementById('expense-category')?.value||'سایر',payment_method:document.getElementById('expense-method')?.value||'سایر',account_id:document.getElementById('expense-account')?.value||null,description:(document.getElementById('expense-description')?.value||'').trim(),repeat_months:repeatMonths,reminder_days:reminderDays,receipts:_cloneData(window._pendingExpenseReceipts||[]),updated_at:new Date().toISOString()});
  if(id==null)_db.expenses.push(expense);
  _db.expense_reminders=_db.expense_reminders||[];
  const existingReminder=_db.expense_reminders.find(r=>String(r.expense_id)===String(expense.id)&&!r.done);
  if(repeatMonths>0){
    const [jy,jm,jd]=_jalaliParse(date);
    const nextDate=_formatJalali(..._addMonths(jy,jm,jd,repeatMonths));
    if(existingReminder)Object.assign(existingReminder,{due_date_jalali:nextDate,repeat_months:repeatMonths,reminder_days:reminderDays,amount,category:expense.category,description:expense.description||'',updated_at:new Date().toISOString()});
    else _db.expense_reminders.push({id:_db._nextId.expense_reminders++,expense_id:expense.id,due_date_jalali:nextDate,repeat_months:repeatMonths,reminder_days:reminderDays,amount,category:expense.category,description:expense.description||'',done:false,created_at:new Date().toISOString()});
  }else if(existingReminder){_db.expense_reminders=_db.expense_reminders.filter(r=>r!==existingReminder);}
  _save();
  showToast('هزینه ذخیره شد ✓','success');
  openExpenseManager();
}

async function deleteExpense(id) {
  const expense=(_db.expenses||[]).find(e=>String(e.id)===String(id));
  if(expense?.source==='staff_payment'){showToast('این هزینه از پرداخت حقوق ساخته شده؛ آن را از حساب پرسنل اصلاح کنید','error');return;}
  if(!expense||!confirm('این هزینه حذف شود؟'))return;
  try{await _IDB.deleteMany((expense.receipts||[]).map(a=>a.id));}catch(e){}
  _db.expenses=_db.expenses.filter(e=>String(e.id)!==String(id));
  _db.expense_reminders=(_db.expense_reminders||[]).filter(r=>String(r.expense_id)!==String(id));
  _save();
  showToast('هزینه حذف شد','error');
  openExpenseManager();
}

function openExpenseManager() {
  const list=(_db.expenses||[]).slice().sort((a,b)=>_jalaliKey(b.date_jalali)-_jalaliKey(a.date_jalali)||Number(b.id)-Number(a.id));
  const total=list.reduce((s,e)=>s+Number(e.amount||0),0);
  const reminderByExpense=new Map((_db.expense_reminders||[]).filter(r=>!r.done).map(r=>[String(r.expense_id),r]));
  openModal('🧾 مدیریت هزینه‌ها',`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px;flex-wrap:wrap"><div><div style="font-size:11px;color:var(--text3)">جمع کل هزینه‌های ثبت‌شده</div><div style="font-size:20px;font-weight:800;color:var(--red)">${fmt(total)} <small style="font-size:10px">تومان</small></div></div><button class="btn btn-primary" onclick="openExpenseForm()">+ هزینه جدید</button></div>
    ${list.length?`<div style="display:flex;flex-direction:column;gap:8px">${list.map(e=>{const reminder=reminderByExpense.get(String(e.id));return `<div style="display:grid;grid-template-columns:minmax(120px,1fr) auto;gap:10px;padding:12px;border:1px solid var(--border2);border-radius:12px;background:var(--bg3)"><div><div style="font-size:13px;font-weight:700">${escapeHtml(e.category||'سایر')} ${e.source==='staff_payment'?'<span style="font-size:10px;color:var(--accent2);font-weight:400">خودکار از حقوق</span>':''} <span style="font-size:10px;color:var(--text3);font-weight:400">${DateService.disp(e.date_jalali||'')}</span></div><div style="font-size:11px;color:var(--text2);margin-top:4px">${escapeHtml(e.description||e.payment_method||'بدون شرح')}</div>${Number(e.repeat_months||0)>0?`<div style="font-size:10px;color:var(--accent2);margin-top:5px">🔁 ${_expenseRepeatLabel(e.repeat_months)} · یادآوری: ${DateService.disp(reminder?.due_date_jalali||'—')}</div>`:''}${(e.receipts||[]).length?`<button class="btn btn-ghost btn-sm" style="margin-top:7px" onclick="_openAttachment('${e.receipts[0].id}',${escapeAttr(e.receipts[0].name)},${escapeAttr(e.receipts[0].type)})">🖼 مشاهده رسید</button>`:''}</div><div style="text-align:left"><div style="font-weight:800;color:var(--red);white-space:nowrap">${fmt(e.amount)} تومان</div><div style="display:flex;gap:4px;margin-top:8px;justify-content:flex-end"><button class="btn btn-ghost btn-sm" onclick="openExpenseForm(${Number(e.id)})">ویرایش</button>${e.source==='staff_payment'?'<span style="font-size:10px;color:var(--text3);align-self:center">از حساب پرسنل</span>':`<button class="btn btn-danger btn-sm" onclick="deleteExpense(${Number(e.id)})">حذف</button>`}</div></div></div>`;}).join('')}</div>`:'<div style="text-align:center;padding:32px;color:var(--text3)">هنوز هزینه‌ای ثبت نشده است</div>'}`,[{label:'بستن',cls:'btn-ghost',action:'closeModal()'}],{fullPage:true});
}

async function renderDashboard() {
  updateTopbarActions('');
  const stats = await window.api.dashboard.stats();
  const { totalStudents, totalPaid, totalAmount, totalWallet, totalSessions, debtors, topEarners, familyGroups, pkgDistribution, upcomingReminders, monthlyIncome, monthlyExpenses, currentMonthIncome, currentMonthLabel, currentYearTotal, currentJalaliYear, currentMonthExpenses, previousMonthExpenses, expenseChangePercent, topExpenseCategory, unpaidStaffSalary, staffDueCount, staffPaymentAlerts, customerDueAlerts, expenseDueAlerts } = stats;
  const netDebt = Math.max(0, totalAmount - totalPaid - totalWallet);
  const openCommitments = netDebt + Number(unpaidStaffSalary || 0);
  const monthlyCashProfit = Number(currentMonthIncome || 0) - Number(currentMonthExpenses || 0);
  const collected = totalAmount > 0 ? Math.round(totalPaid / totalAmount * 100) : 0;
  const incomeMonthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const incomeYears = [...new Set([currentJalaliYear, ...monthlyIncome.map(m => Number(m.jy)).filter(Boolean)])].sort((a,b) => b-a);
  let selectedIncomeYear = Number(window._dashboardIncomeYear || currentJalaliYear);
  if (!incomeYears.includes(selectedIncomeYear)) selectedIncomeYear = currentJalaliYear;
  window._dashboardIncomeYear = selectedIncomeYear;
  const currentJalaliMonth = _todayJalali()[1];
  const incomeMonthLimit = selectedIncomeYear === currentJalaliYear ? currentJalaliMonth : 12;
  const incomeByMonth = new Map(monthlyIncome.filter(m => Number(m.jy) === selectedIncomeYear).map(m => [Number(m.jm), Number(m.total || 0)]));
  const selectedYearMonths = Array.from({length: incomeMonthLimit}, (_, index) => {
    const jm = index + 1;
    return { jy: selectedIncomeYear, jm, label: `${incomeMonthNames[index]} ${fa(selectedIncomeYear)}`, total: incomeByMonth.get(jm) || 0 };
  }).reverse();
  const selectedYearTotal = selectedYearMonths.reduce((sum, month) => sum + month.total, 0);
  const selectedFocusMonth = selectedYearMonths[0] || { label: `سال ${fa(selectedIncomeYear)}`, total: 0, jm: 0 };
  const incomeTrendMap = new Map(monthlyIncome.map(m => [`${m.jy}-${m.jm}`, Number(m.total||0)]));
  const expenseTrendMap = new Map((monthlyExpenses||[]).map(m => [`${m.jy}-${m.jm}`, Number(m.total||0)]));
  const [trendYear, trendMonth] = _todayJalali();
  const financialTrend = Array.from({length:6}, (_,index) => {
    const offset = 5-index;
    const totalMonths = trendYear * 12 + (trendMonth - 1) - offset;
    const jy = Math.floor(totalMonths / 12), jm = totalMonths % 12 + 1;
    const income = incomeTrendMap.get(`${jy}-${jm}`) || 0;
    const expense = expenseTrendMap.get(`${jy}-${jm}`) || 0;
    return { jy, jm, label: incomeMonthNames[jm-1], income, expense, profit:income-expense };
  });
  const trendMax = Math.max(1,...financialTrend.flatMap(m=>[m.income,m.expense,Math.abs(m.profit)]));
  const financialTrendHtml = financialTrend.map(m => {
    const incomeHeight=Math.max(m.income?8:0,Math.round(m.income/trendMax*86));
    const expenseHeight=Math.max(m.expense?8:0,Math.round(m.expense/trendMax*86));
    const profitColor=m.profit>=0?'var(--green)':'var(--red)';
    return `<div style="flex:1;min-width:54px;display:flex;flex-direction:column;align-items:center;gap:6px"><div style="height:92px;width:100%;display:flex;align-items:flex-end;justify-content:center;gap:4px;border-bottom:1px solid var(--border2)"><span title="درآمد: ${fmt(m.income)} تومان" style="display:block;width:12px;height:${incomeHeight}px;min-height:${m.income?8:1}px;border-radius:5px 5px 1px 1px;background:var(--green)"></span><span title="هزینه: ${fmt(m.expense)} تومان" style="display:block;width:12px;height:${expenseHeight}px;min-height:${m.expense?8:1}px;border-radius:5px 5px 1px 1px;background:var(--red)"></span></div><div style="font-size:10px;color:var(--text2)">${escapeHtml(m.label)}</div><div style="font-size:9px;font-weight:700;color:${profitColor};white-space:nowrap">${m.profit>=0?'+':''}${fmt(m.profit)}</div></div>`;
  }).join('');
  const dueLabel = days => days < 0 ? `${fa(Math.abs(days))} روز تأخیر` : days === 0 ? 'سررسید امروز' : `${fa(days)} روز مانده`;
  const financialAlerts = [
    ...(customerDueAlerts||[]).slice(0,3).map(item=>({kind:'customer',icon:'👤',title:`پرداخت ${item.name} ${item.lname}`,detail:`${dueLabel(item.dueIn)} · ${fmt(item.amount)} تومان`,id:item.studentId,urgent:item.dueIn<=0})),
    ...(staffPaymentAlerts||[]).slice(0,3).map(item=>({kind:'staff',icon:'💼',title:`حقوق ${item.name} ${item.lname}`,detail:`${dueLabel(item.dueIn)} · ${fmt(item.amount)} تومان`,id:item.staffId,urgent:item.dueIn<=0})),
    ...(expenseDueAlerts||[]).slice(0,3).map(item=>({kind:'expense-reminder',icon:'🧾',title:`هزینه ${item.category}`,detail:`${dueLabel(item.dueIn)} · ${fmt(item.amount)} تومان${item.description?` · ${item.description}`:''}`,id:item.expenseId,urgent:item.dueIn<=0})),
    ...(previousMonthExpenses>0&&expenseChangePercent>=20?[{kind:'expense',icon:'📈',title:'افزایش هزینه ماهانه',detail:`هزینه‌ها ${fa(expenseChangePercent)}٪ بیشتر از ماه قبل شده‌اند`,urgent:true}]:[])
  ];

  const html = `<div class="stats-row finance-dashboard-stats" aria-label="خلاصه مالی ماه جاری">
    <div class="stat-card s-green">
      <div class="stat-label">درآمد دریافت‌شده</div>
      <div class="stat-value">${fmt(currentMonthIncome||0)}</div>
      <div class="stat-sub">${escapeHtml(currentMonthLabel||'ماه جاری')} · پرداخت‌های مشتریان</div>
    </div>
    <div class="stat-card s-red">
      <div class="stat-label">هزینه پرداخت‌شده</div>
      <div class="stat-value">${fmt(currentMonthExpenses||0)}</div>
      <div class="stat-sub">${topExpenseCategory?`بیشترین: ${escapeHtml(topExpenseCategory[0])}`:'هزینه‌های ثبت‌شده این ماه'}</div>
    </div>
    <div class="stat-card ${monthlyCashProfit>=0?'s-accent':'s-red'}">
      <div class="stat-label">سود نقدی</div>
      <div class="stat-value" style="color:${monthlyCashProfit>=0?'var(--accent2)':'var(--red)'}">${fmt(monthlyCashProfit)}</div>
      <div class="stat-sub">درآمد دریافت‌شده − هزینه پرداخت‌شده</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">تعهدات باز</div>
      <div class="stat-value" style="color:${openCommitments>0?'var(--amber)':'var(--green)'}">${fmt(openCommitments)}</div>
      <div class="stat-sub">مطالبات مشتریان: ${fmt(netDebt)}${staffDueCount?` · حقوق پرداخت‌نشده: ${fmt(unpaidStaffSalary)}`:''}</div>
    </div>
  </div>

  <div class="detail-section finance-alerts">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><h3 style="margin:0">⚠️ پیگیری‌های مالی</h3><span style="font-size:10px;color:var(--text3)">${fa(financialAlerts.length)} مورد</span></div>
    ${financialAlerts.length ? financialAlerts.map(item=>`<button type="button" onclick="${item.kind==='customer'?`openDashboardCustomerAccount(${Number(item.id)})`:item.kind==='staff'?`openDashboardStaffAccount(${Number(item.id)})`:'openExpenseManager()'}" style="width:100%;display:flex;align-items:center;gap:9px;text-align:right;border:0;border-bottom:1px solid var(--border2);background:transparent;color:inherit;padding:10px 2px;cursor:pointer"><span style="font-size:16px">${escapeHtml(item.icon)}</span><span style="min-width:0;flex:1"><b style="display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(item.title)}</b><small style="display:block;margin-top:3px;color:${item.urgent?'var(--red)':'var(--text3)'};font-size:10px">${escapeHtml(item.detail)}</small></span><span style="color:var(--text3)">←</span></button>`).join(''):'<div style="padding:12px 0;color:var(--green);font-size:12px">✓ مورد مالی فوری برای پیگیری نیست</div>'}
  </div>

  <div class="detail-section" style="margin-top:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px"><div><h3 style="margin:0">📊 روند مالی ۶ ماه اخیر</h3><div style="font-size:10px;color:var(--text3);margin-top:4px">مقایسه درآمد و هزینه؛ عدد زیر هر ماه سود نقدی است</div></div><div style="display:flex;gap:10px;font-size:10px;color:var(--text2)"><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-left:4px"></i>درآمد</span><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-left:4px"></i>هزینه</span></div></div>
    <div style="display:flex;align-items:stretch;gap:8px;overflow-x:auto;padding:4px 2px 2px">${financialTrendHtml}</div>
  </div>

  <details class="finance-advanced">
    <summary><span>گزارش‌ها و برنامه‌ریزی پیشرفته <small style="display:block;margin-top:3px;color:var(--text3);font-size:10px;font-weight:500">بودجه ماه و پیش‌بینی جریان نقدی</small></span></summary>
    <div class="finance-advanced-body">
      ${budgetDashboardHtml(currentJalaliYear,currentJalaliMonth)}
      ${cashForecastDashboardHtml()}
    </div>
  </details>

  <div class="dash-grid" style="margin-top:14px;grid-template-columns:1fr">
    <div class="detail-section">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px"><h3 style="margin:0">🧾 خلاصه هزینه‌ها</h3><button class="btn btn-ghost btn-sm" onclick="openExpenseManager()">مدیریت</button></div>
      <div class="detail-row"><span class="detail-key">هزینه ${escapeHtml(currentMonthLabel||'ماه جاری')}</span><span class="detail-val" style="color:var(--red)">${fmt(currentMonthExpenses||0)} تومان</span></div>
      <div class="detail-row"><span class="detail-key">دسته پرهزینه</span><span class="detail-val">${topExpenseCategory?`${escapeHtml(topExpenseCategory[0])} · ${fmt(topExpenseCategory[1])} تومان`:'هنوز هزینه‌ای ثبت نشده'}</span></div>
      <div class="detail-row"><span class="detail-key">تغییر نسبت به ماه قبل</span><span class="detail-val" style="color:${expenseChangePercent>0?'var(--red)':'var(--green)'}">${previousMonthExpenses?`${expenseChangePercent>=0?'▲':'▼'} ${fa(Math.abs(expenseChangePercent))}٪`:'—'}</span></div>
    </div>
  </div>

  <div class="dash-grid">
    <div class="detail-section">
      <h3>توزیع پکیج‌ها / خدمات</h3>
      ${pkgDistribution.filter(p=>p.count>0).map(p => `
        <div class="bar-item">
          <div class="bar-label">
            <span>${escapeHtml(p.label)}</span>
            <span style="font-weight:600;color:var(--text)">${fa(p.count)} نفر</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${totalStudents ? p.count/totalStudents*100 : 0}%;background:${p.color}"></div>
          </div>
        </div>`).join('') || '<p style="color:var(--text3);font-size:12px">پکیجی ثبت نشده</p>'}
    </div>

    <div class="detail-section">
      <h3>بدهکاران</h3>
      ${debtors.length === 0
        ? '<div style="color:var(--green);font-size:13px;padding:8px 0">✓ همه تسویه هستند</div>'
        : `<div class="stu-table-wrap dashboard-debtors-wrap">
            <table>
              <thead>
                <tr>
                  <th>نام</th>
                  <th>پکیج</th>
                  <th>قرارداد کل</th>
                  <th>مانده حساب</th>
                </tr>
              </thead>
              <tbody>
                ${debtors.map(d => `
                  <tr>
                    <td>
                      <div class="name-cell">
                        ${avatar(d.name, d.id)}
                        <div>
                          <div style="font-weight:500">${escapeHtml(d.name)} ${escapeHtml(d.lname)}</div>
                        </div>
                      </div>
                    </td>
                    <td>${(d.packages || []).map(pkgTag).join('') || '<span style="color:var(--text3)">—</span>'}</td>
                    <td><span class="amount amount-neutral">${fmt(d.totalAmount)}</span></td>
                    <td>${balanceHtml(d.debt)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>`}
    </div>
  </div>

  ${familyGroups.length > 0 ? `
  <div class="detail-section" style="margin-top:14px">
    <h3>👨‍👩‍👧 مانده حساب‌های مشترک</h3>
    ${familyGroups.map(f => `
      <div class="detail-row">
        <span class="detail-key">${escapeHtml(f.name)} (${fa(f.members.length)} نفر)</span>
        <span class="detail-val">${familyBalanceHtml(f.totalBalance)}</span>
      </div>`).join('')}
  </div>` : ''}

  ${topEarners.length > 0 ? `
  <div class="detail-section" style="margin-top:14px">
    <h3>💰 پول‌سازترین ${META.entityPlural || 'شاگردان'} <span style="font-size:10px;color:var(--text3);font-weight:400">(۷۰٪ میزان پرداختی + ۳۰٪ سرعت پرداخت)</span></h3>
    ${topEarners.map((e,i) => `
      <div class="detail-row" ${i >= 10 ? 'data-top-earner-extra style="display:none"' : ''}>
        <span class="detail-key">${fa(i+1)}. ${escapeHtml(e.name)} ${escapeHtml(e.lname)}</span>
        <span class="detail-val amount-paid">${fmt(e.paid)} تومان</span>
      </div>`).join('')}
    ${topEarners.length > 10 ? `
      <div style="display:flex;justify-content:center;padding-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" aria-expanded="false" onclick="toggleTopEarners(this)">مشاهده ادامه</button>
      </div>` : ''}
  </div>` : ''}

  <div class="detail-section" id="dashboard-income-report" style="margin-top:14px;scroll-margin-top:18px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px">
      <h3 style="margin:0">📅 گزارش درآمد ماهانه</h3>
      <label style="display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text2)">
        <span>انتخاب سال</span>
        <select class="form-select" aria-label="انتخاب سال گزارش درآمد" onchange="changeDashboardIncomeYear(this.value)" style="width:auto;min-width:108px;padding:7px 30px 7px 10px">
          ${incomeYears.map(year => `<option value="${year}" ${year===selectedIncomeYear?'selected':''}>${fa(year)}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="stats-row" style="margin-bottom:14px">
      <div class="stat-card s-green">
        <div class="stat-label">درآمد ${escapeHtml(selectedFocusMonth.label)}${selectedIncomeYear===currentJalaliYear?' (ماه جاری)':''}</div>
        <div class="stat-value">${fmt(selectedFocusMonth.total)}</div>
        <div class="stat-sub">تومان</div>
      </div>
      <div class="stat-card s-accent">
        <div class="stat-label">جمع درآمد سال ${fa(selectedIncomeYear)}</div>
        <div class="stat-value">${fmt(selectedYearTotal)}</div>
        <div class="stat-sub">تومان — مناسب گزارش پایان سال</div>
      </div>
    </div>
    ${selectedYearMonths.map((m, index) => `
        <div class="detail-row" ${index >= 6 ? 'data-monthly-income-extra style="display:none"' : ''}>
          <span class="detail-key">${escapeHtml(m.label)}${selectedIncomeYear===currentJalaliYear && m.jm===currentJalaliMonth ? ' <span style="color:var(--accent2);font-size:10px">(ماه جاری)</span>' : ''}</span>
          <span class="detail-val amount-paid">${fmt(m.total)} تومان</span>
        </div>`).join('')}
    ${selectedYearMonths.length > 6 ? `
      <div style="display:flex;justify-content:center;padding-top:12px">
        <button type="button" class="btn btn-ghost btn-sm" aria-expanded="false" onclick="toggleMonthlyIncome(this)">مشاهده ادامه</button>
      </div>` : ''}
  </div>
  `;
  setContent(html);
}

// ════════════════════════════════════════════════════════════════════════════
// STAFF / MEMBER ACCOUNTS — separate from students
// ════════════════════════════════════════════════════════════════════════════
let STAFF_ROLES = [];
let _staffReturnToTodoAfterSave = false;
let _staffTrendSelectedId = null;

function staffIsPersonnel(s) {
  return (s?.person_type || 'personnel') === 'personnel';
}

function staffPersonTypeLabel(s) {
  return staffIsPersonnel(s) ? 'پرسنل' : 'عضو';
}

async function renderStaff() {
  updateTopbarActions(`<button class="btn btn-primary" onclick="openAddStaffChoice()">+ افزودن</button>`);
  STAFF_ROLES = await window.api.staffRoles.getAll();
  const staffList = await window.api.staff.getAll();
  const personnelCount = staffList.filter(staffIsPersonnel).length;
  const memberCount = staffList.length - personnelCount;
  const dash = await window.api.staff.getDashboard();
  const reminders = await window.api.staffReminders.getAll();
  const remByStaff = {};
  reminders.forEach(r => { if (!remByStaff[r.staff_id]) remByStaff[r.staff_id] = r; });
  const today = jalaliKey(formatJalali(...todayJalali()));

  let html = `
  <div class="stats-row stats-bento">
    <div class="stat-card s-accent">
      <div class="stat-label">تعداد پرسنل و اعضا</div>
      <div class="stat-value">${fa(dash.totalStaff)}</div>
      <div class="stat-sub">${fa(personnelCount)} پرسنل، ${fa(memberCount)} عضو</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">جمع حقوق ثابت ماهانه</div>
      <div class="stat-value">${fmt(dash.totalMonthlySalary)}</div>
      <div class="stat-sub">تومان</div>
    </div>
    <div class="stat-card s-green">
      <div class="stat-label">پرداختی این ماه</div>
      <div class="stat-value">${fmt(dash.paidThisMonth)}</div>
      <div class="stat-sub">حقوق + پاداش/جریمه/پروژه</div>
    </div>
    <div class="stat-card">
      <div class="stat-label">یادآوری‌های باز</div>
      <div class="stat-value" style="color:${dash.upcomingReminders>0?'var(--amber)':'var(--text)'}">${fa(dash.upcomingReminders)}</div>
      <div class="stat-sub">⏰ پرداخت حقوق</div>
    </div>
  </div>

  <div class="table-card staff-accounts-table tbl-responsive">
    <div class="table-header">
      <div class="title-wrap">
        <span class="title">لیست پرسنل و اعضا</span>
        <span class="subtitle">${fa(staffList.length)} نفر — مدیریت حقوق، اجاره، پرداخت‌ها و اعضای غیرپرسنل</span>
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-right:auto" onclick="openManageRoles()">🏷 مدیریت نقش‌ها</button>
    </div>
    <table>
      <thead><tr><th>نام</th><th>نوع</th><th>نقش‌ها</th><th>شماره کارت</th><th>حقوق/پرداخت این ماه (${JMONTHS[todayJalali()[1]-1]})</th><th>جمع پرداختی</th><th>سررسید این ماه</th><th>عملیات</th></tr></thead>
      <tbody>`;

  if (staffList.length === 0) {
    html += `<tr><td colspan="8"><div class="empty"><span>🧑‍💼</span>هنوز پرسنل یا عضوی ثبت نشده</div></td></tr>`;
  } else {
    staffList.forEach((s,i) => {
      const roleTags = [
        s.salary > 0 ? `<span class="tag tag-coaching">حقوق ثابت: ${fmt(s.salary)}</span>` : '',
        ...(s.roles||[]).map(r => `<span class="tag" style="background:var(--accent2)22;color:var(--accent2)">${escapeHtml(r.role_label)}${r.amount?`: ${fmt(r.amount)}×${fa(r.count??1)}`:''}</span>`)
      ].filter(Boolean).join(' ') || '<span style="color:var(--text3)">—</span>';

      // سررسید این ماه = تاریخ سررسید یادآوری
      const rem = remByStaff[s.id];
      const dueDateCell = rem ? rem.due_date_jalali : '—';

      // جمع پرداختی واقعی = پرداخت‌ها + پاداش - جریمه
      const totalPaidDisplay = s.totalPaid;

      // Status: is this staff member already paid for the current cycle?
      const isPaid = !!s.paid_this_month;

      const cardMasked = s.card_number
        ? `<span class="card-masked">${maskCardNumber(s.card_number)}<button class="card-copy-btn" title="کپی شماره کارت کامل" onclick="copyToClipboard('${(s.card_number||'').replace(/\D/g,'')}', 'شماره کارت کپی شد ✓')">📋</button></span>`
        : `<span style="color:var(--text3)">—</span>`;

      const rowMenuId = `staff-menu-${s.id}`;
      html += `<tr>
        <td data-label="نام">
          <div class="name-cell">
            ${avatar(s.name, i)}
            <div><div style="font-weight:500">${escapeHtml(s.name)} ${escapeHtml(s.lname)}</div><div class="name-cell-sub">${escapeHtml(s.phone||'—')}</div></div>
          </div>
        </td>
        <td data-label="نوع"><span class="tag" style="background:${staffIsPersonnel(s)?'rgba(124,106,247,.18)':'rgba(96,165,250,.16)'};color:${staffIsPersonnel(s)?'var(--accent2)':'#60a5fa'}">${staffPersonTypeLabel(s)}</span></td>
        <td data-label="نقش‌ها" class="staff-role-cell"><div class="staff-role-cell-inner">${staffIsPersonnel(s) ? roleTags : '<span style="color:var(--text3)">عضو پرداختی</span>'}</div></td>
        <td data-label="شماره کارت">${cardMasked}</td>
        <td data-label="حقوق این ماه"><span class="amount amount-neutral">${fmt(s.expectedMonthly)} ت</span></td>
        <td data-label="جمع پرداختی"><span class="amount amount-paid">${fmt(totalPaidDisplay)} ت</span></td>
        <td data-label="سررسید این ماه" style="font-size:12px;color:var(--text2)">${dueDateCell}</td>
        <td data-label="عملیات" class="staff-actions-cell">
          <div class="row-menu">
            <button class="row-menu-btn" onclick="toggleRowMenu(event,'${rowMenuId}')">⋮</button>
            <div class="row-menu-panel" id="${rowMenuId}">
              ${!isPaid ? `<div class="row-menu-item" onclick="openSalaryTransfer(${s.id})">💳 واریز حقوق</div><div class="row-menu-item" onclick="payStaffSalary(${s.id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">✓ ثبت دستی پرداخت</div>` : `<div class="row-menu-item" onclick="payStaffSalary(${s.id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">✓ ثبت پرداخت اصلاحی</div>`}
              <div class="row-menu-item" onclick="openStaffDetail(${s.id})">📊 جزئیات و آمار</div>
              <div class="row-menu-item" onclick="openStaffModal(${s.id})">✏️ تنظیمات حساب</div>
              <div class="row-menu-item" onclick="openSetStaffPassword(${s.id})">🔐 تغییر رمز</div>
              <div class="row-menu-divider"></div>
              <div class="row-menu-item danger" onclick="deleteStaff(${s.id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">🗑 حذف</div>
            </div>
          </div>
        </td>
      </tr>`;
    });
  }
  html += `</tbody></table></div>`;

  // ── Salary reminders ────────────────────────────────────────────────────
  html += `<div class="table-card"><div class="table-header"><div class="title-wrap"><span class="title">⏰ یادآوری‌های پرداخت حقوق</span><span class="subtitle">سررسیدهای نزدیک و یادآوری‌های خودکار</span></div><button class="btn btn-primary btn-sm" style="margin-right:auto" onclick="openAddStaffReminder()">+ افزودن یادآوری پرداخت حقوق</button></div>`;
  if (reminders.length === 0) {
    html += `<div class="empty"><span>⏰</span>یادآوری‌ای ثبت نشده — با ثبت پرداخت برای یک نفر، یادآوری به‌صورت خودکار اینجا اضافه می‌شود</div>`;
  } else {
    html += `<table><thead><tr><th>پرسنل/عضو</th><th>سررسید آینده</th><th>مبلغ (زنده)</th><th>تکرار</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>`;
    reminders.forEach(r => {
      const du = r.days_until;
      let statusBadge;
      if (r.paid_this_month) {
        const months = Math.floor(Math.abs(du)/30), remDays = Math.abs(du)%30;
        const remainText = months>0 ? `${fa(months)} ماه و ${fa(remDays)} روز` : `${fa(remDays)} روز`;
        statusBadge = `<span class="status status-ok">پرداخت شد ✓ — ${fa(Math.abs(du))} روز تا سررسید آینده</span>`;
      } else if (du < 0) {
        statusBadge = `<span class="status status-debt">${fa(Math.abs(du))} روز تاخیر در پرداخت</span>`;
      } else if (du <= 3) {
        statusBadge = `<span class="status" style="color:var(--amber);font-weight:600">به زمان واریز حقوق نزدیک می‌شویم (${fa(du)} روز مانده)</span>`;
      } else {
        const months = Math.floor(du/30), remDays = du%30;
        const remainText = months>0 ? (remDays>0?`${fa(months)} ماه و ${fa(remDays)} روز مانده`:`${fa(months)} ماه مانده`) : `${fa(remDays)} روز مانده`;
        statusBadge = `<span class="status" style="color:var(--green)">هنوز نرسیده (${remainText})</span>`;
      }
      const remMenuId = `rem-menu-${r.id}`;
      html += `<tr>
        <td style="font-weight:500">${escapeHtml(r.name)} ${escapeHtml(r.lname)}</td>
        <td style="font-size:12px">${DateService.disp(r.due_date_jalali)}</td>
        <td><span class="amount" style="${du<0&&!r.paid_this_month?'color:var(--red);font-weight:700':''}">${fmt(r.live_amount)} ت</span></td>
        <td style="font-size:11px;color:var(--text2)">${r.repeat_months>0?`هر ${fa(r.repeat_months)} ماه`:'یک‌بار'}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="row-menu">
            <button class="row-menu-btn" onclick="toggleRowMenu(event,'${remMenuId}')">⋮</button>
            <div class="row-menu-panel" id="${remMenuId}">
              <div class="row-menu-item" onclick="openStaffDetail(${r.staff_id})">📊 جزئیات</div>
              <div class="row-menu-item" onclick="openEditStaffReminder(${r.id})">✏️ ویرایش</div>
              <div class="row-menu-divider"></div>
              <div class="row-menu-item danger" onclick="deleteStaffReminder(${r.id})">🗑 حذف</div>
            </div>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // ── Salary payment history ───────────────────────────────────────────────
  const paidHistory = await window.api.staffMonthly.getAllPaid();
  html += `<div class="table-card"><div class="table-header"><div class="title-wrap"><span class="title">📜 تاریخچه پرداخت‌های حقوق</span><span class="subtitle">${fa(paidHistory.length)} پرداخت ثبت‌شده</span></div></div>`;
  if (paidHistory.length === 0) {
    html += `<div class="empty"><span>📜</span>هنوز پرداختی ثبت نشده</div>`;
  } else {
    html += `<table><thead><tr><th>نام و نام‌خانوادگی</th><th>ماه و سال</th><th>حقوق آن ماه</th><th>عملیات</th></tr></thead><tbody>`;
    paidHistory.forEach(m => {
      const historyMenuId = `salary-history-menu-${m.id}`;
      const staffPlainName = `${m.name || ''} ${m.lname || ''}`.trim();
      const staffFullName = escapeHtml(staffPlainName);
      html += `<tr>
        <td style="font-weight:500">${escapeHtml(m.name)} ${escapeHtml(m.lname)}</td>
        <td>${escapeHtml(m.label)}</td>
        <td>
          <span class="amount amount-paid">${fmt(m.grand_total)} تومان</span>
          ${m.adj_total !== 0 ? `<div style="font-size:10px;color:${m.adj_total>0?'var(--green)':'var(--red)'};margin-top:2px">(حقوق: ${fmt(m.total)} ${m.adj_total>0?'+ پاداش':'- جریمه'}: ${fmt(Math.abs(m.adj_total))})</div>` : ''}
        </td>
        <td data-label="عملیات">
          <div class="row-menu">
            <button class="row-menu-btn" type="button" aria-label="عملیات پرداخت ${staffFullName}" aria-haspopup="menu" onclick="toggleRowMenu(event,'${historyMenuId}')">⋮</button>
            <div class="row-menu-panel" id="${historyMenuId}" role="menu">
              <div class="row-menu-item" role="menuitem" onclick="openStaffDetail(${m.staff_id})">📊 جزئیات</div>
              <div class="row-menu-item" role="menuitem" onclick="openFixMonthlyMonth(${m.id}, ${m.staff_id}, ${escapeAttr(staffPlainName)}, ${m.jy}, ${m.jm}, true)">✏️ ویرایش</div>
              <div class="row-menu-divider"></div>
              <div class="row-menu-item danger" role="menuitem" onclick="deleteSalaryHistory(${m.id})">🗑 حذف</div>
            </div>
          </div>
        </td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  // ── Income trend chart ───────────────────────────────────────────────────
  const allTrends = await window.api.staffMonthly.getTrends();
  const personnelIds = new Set(staffList.filter(staffIsPersonnel).map(s => +s.id));
  const trends = allTrends.filter(t => personnelIds.has(+t.staff_id));
  if (!trends.some(t => +t.staff_id === +_staffTrendSelectedId)) {
    _staffTrendSelectedId = trends.length ? trends[0].staff_id : null;
  }
  html += `<div class="table-card">
    <div class="table-header">
      <div class="title-wrap">
        <span class="title">📈 روند پرداخت پرسنل</span>
        <span class="subtitle">برای مشاهده نمودار و جزئیات، نام پرسنل را انتخاب کنید</span>
      </div>
      ${trends.length ? `<label class="staff-trend-picker" style="margin-right:auto;display:flex;align-items:center;gap:8px;color:var(--text2);font-size:11px">
        <span>انتخاب پرسنل</span>
        <select id="staff-trend-select" onchange="_selectStaffTrend(this.value)" style="min-width:190px;height:36px;padding:0 10px;border:1px solid var(--border2);border-radius:9px;background:var(--bg3);color:var(--text);font-family:var(--font);font-size:12px;font-weight:600;outline:none">
          ${trends.map(t => `<option value="${t.staff_id}" ${+t.staff_id===+_staffTrendSelectedId?'selected':''}>${escapeHtml(`${t.name} ${t.lname}`.trim())}</option>`).join('')}
        </select>
      </label>` : ''}
    </div>`;
  if (trends.length === 0) {
    html += `<div class="empty"><span>📈</span>برای نمایش روند پرسنل، حداقل ۲ ماه حقوق برای یک پرسنل ثبت کنید</div>`;
  } else {
    const latestTotals = trends
      .map(t => t.months && t.months.length ? t.months[t.months.length - 1].total : 0)
      .filter(Boolean);
    const teamAvg = latestTotals.length ? Math.round(latestTotals.reduce((a, b) => a + b, 0) / latestTotals.length) : 0;
    html += `<div id="trends-container">`;
    trends.forEach(t => {
      html += `<div class="staff-trend-panel" data-staff-id="${t.staff_id}" style="display:${+t.staff_id===+_staffTrendSelectedId?'block':'none'}">${buildSalaryReportCard(t, teamAvg)}</div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;

  setContent(html);

}

function _selectStaffTrend(staffId) {
  _staffTrendSelectedId = staffId;
  document.querySelectorAll('.staff-trend-panel').forEach(panel => {
    panel.style.display = +panel.dataset.staffId === +staffId ? 'block' : 'none';
  });
}

// ── Salary report card (financial profile + chart + insight) ───────────────────
function buildSalaryReportCard(t, teamAvg = 0) {
  const months = t.months;
  const last = months[months.length - 1];
  const prev = months.length > 1 ? months[months.length - 2] : null;
  const totals = months.map(m => m.total);
  const avg = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
  const maxV = Math.max(...totals);
  const minV = Math.min(...totals);
  const totalPaid = totals.reduce((a, b) => a + b, 0);
  const paidCount = months.filter(m => m.paid).length;
  const rangeLabel = months.length <= 3 ? '۳ ماه' : months.length <= 6 ? '۶ ماه' : months.length <= 12 ? '۱۲ ماه' : 'همه';
  const salaryGoal = Math.max(20000000, Math.ceil(last.total * 1.16 / 1000000) * 1000000);
  const goalPct = Math.min(100, Math.round((last.total / salaryGoal) * 100));
  const teamDeltaPct = teamAvg ? Math.round(((last.total - teamAvg) / teamAvg) * 100) : 0;

  // Change vs previous month
  let changeHtml = `<div class="salary-change flat">— بدون سابقه ماه قبل</div>`;
  let changeHero = `<div class="salary-change-hero"><div><strong style="color:var(--text3)">—</strong><small>بدون سابقه ماه قبل</small></div><div class="amount">اولین داده روند</div></div>`;
  let diff = 0, pct = 0;
  if (prev) {
    diff = last.total - prev.total;
    pct = prev.total ? Math.round((diff / prev.total) * 100) : 0;
    const sign = diff > 0 ? '+' : diff < 0 ? '-' : '';
    const changeClass = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
    const changeColor = diff > 0 ? 'var(--green)' : diff < 0 ? 'var(--red)' : 'var(--text3)';
    if (diff > 0) changeHtml = `<div class="salary-change up">▲ ${fmt(diff)} (${fa('+' + pct)}٪) نسبت به ماه قبل</div>`;
    else if (diff < 0) changeHtml = `<div class="salary-change down">▼ ${fmt(-diff)} (${fa(pct)}٪) نسبت به ماه قبل</div>`;
    else changeHtml = `<div class="salary-change flat">= بدون تغییر نسبت به ماه قبل</div>`;
    changeHero = `<div class="salary-change-hero">
      <div><strong style="color:${changeColor}">${diff > 0 ? '▲' : diff < 0 ? '▼' : '='} ${fa(sign + Math.abs(pct))}٪</strong><small>${changeClass === 'up' ? 'افزایش' : changeClass === 'down' ? 'کاهش' : 'بدون تغییر'} نسبت به ماه قبل</small></div>
      <div class="amount">${diff === 0 ? 'بدون تغییر مبلغ' : `${diff > 0 ? '+' : '-'}${fmt(Math.abs(diff))} تومان`}</div>
    </div>`;
  }

  // ── Sparkline / area chart (SVG) ──
  const chartMonths = months.slice(-12);
  const W = 600, H = chartMonths.length <= 2 ? 76 : 112, PAD = 8;
  const cMin = Math.min(...chartMonths.map(m => m.total));
  const cMax = Math.max(...chartMonths.map(m => m.total));
  const range = Math.max(cMax - cMin, 1);
  const n = chartMonths.length;
  const stepX = n > 1 ? (W - PAD * 2) / (n - 1) : 0;
  const pts = chartMonths.map((m, i) => {
    const x = PAD + i * stepX;
    const y = PAD + (H - PAD * 2) * (1 - (m.total - cMin) / range);
    return { x, y, m };
  });
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD} L${pts[0].x.toFixed(1)},${H - PAD} Z`;
  const dots = pts.map((p, i) => {
    const rolesTotal = (p.m.roles || []).reduce((a, r) => a + (r.amount || 0), 0);
    const bonus = (p.m.roles || []).filter(r => /پاداش|bonus/i.test(r.role_label || '')).reduce((a, r) => a + (r.amount || 0), 0);
    const benefit = Math.max(rolesTotal - bonus, 0);
    const isLast = i === pts.length - 1;
    return `
    <circle class="salary-chart-point" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isLast ? '4.5' : '3.5'}" fill="${isLast && diff >= 0 ? 'var(--green)' : 'var(--accent2)'}" stroke="var(--bg3)" stroke-width="2">
      <title>${escapeHtml(p.m.label)}
حقوق: ${fmt(p.m.total)}
پایه: ${fmt(p.m.fixed_salary || 0)}
مزایا: ${fmt(benefit)}
پاداش: ${fmt(bonus)}
${p.m.paid ? 'پرداخت شد' : 'در انتظار پرداخت'}</title>
    </circle>`;
  }).join('');
  const svg = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sgrad${t.staff_id}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent2)" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="var(--accent2)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${areaPath}" fill="url(#sgrad${t.staff_id})" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${diff >= 0 ? 'var(--green)' : 'var(--accent2)'}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  // Show a few month labels beneath the chart (avoid crowding)
  const labelIdxs = n <= 6 ? pts.map((_, i) => i) : [0, Math.floor((n - 1) / 2), n - 1];
  const chartLabels = labelIdxs.map(i => `<span>${chartMonths[i].label.split(' ')[0]}</span>`).join('');

  // ── Salary breakdown for latest month ──
  let breakdownHtml = '';
  if (last.fixed_salary || (last.roles && last.roles.length)) {
    const rows = [];
    const addBreakdownRow = (label, value) => {
      const pct = last.total ? Math.max(2, Math.round((Math.abs(value) / last.total) * 100)) : 0;
      rows.push(`<div class="salary-breakdown-row">
        <div class="top"><span class="label">${label}</span><span class="val">${value ? `${fmt(value)} تومان` : '—'}</span></div>
        <div class="salary-bar"><span style="width:${pct}%"></span></div>
      </div>`);
    };
    if (last.fixed_salary) addBreakdownRow('حقوق پایه', last.fixed_salary);
    (last.roles || []).forEach(r => {
      addBreakdownRow(r.role_label || 'مزایا', r.amount || 0);
    });
    if (!(last.roles || []).some(r => /پاداش|bonus/i.test(r.role_label || ''))) addBreakdownRow('پاداش', 0);
    addBreakdownRow('کسورات', 0);
    breakdownHtml = `<div class="salary-breakdown">
      <div class="salary-breakdown-title">ترکیب حقوق ${escapeHtml(last.label)}</div>
      ${rows.join('')}
    </div>`;
  }

  // ── Smart insight sentence ──
  let insight = '';
  if (prev && diff !== 0) {
    const dominant = (last.roles && last.roles.length)
      ? [...last.roles].sort((a, b) => b.amount - a.amount)[0]
      : null;
    const reason = diff > 0
      ? (dominant ? `که عمدتاً به دلیل <b>${escapeHtml(dominant.role_label)}</b> بوده است` : `که به دلیل افزایش حقوق پایه بوده است`)
      : '';
    insight = `<div class="salary-insight"><div class="salary-insight-title">تحلیل هوشمند</div>حقوق این ماه نسبت به ماه قبل <b>${fa(Math.abs(pct))}٪ ${diff > 0 ? 'افزایش' : 'کاهش'}</b> داشته است${reason}. روند پرداخت در ${fa(months.length)} ماه اخیر ${paidCount === months.length ? '<b>منظم</b>' : `<b>${fa(paidCount)} پرداخت ثبت‌شده</b>`} بوده و میانگین دریافتی <b>${fmt(avg)} تومان</b> است.</div>`;
  } else {
    insight = `<div class="salary-insight"><div class="salary-insight-title">تحلیل هوشمند</div>میانگین حقوق <b>${escapeHtml(t.name)} ${escapeHtml(t.lname)}</b> در ${fa(months.length)} ماه اخیر <b>${fmt(avg)} تومان</b> بوده است. برای تحلیل تغییرات، حداقل یک ماه دیگر داده لازم است.</div>`;
  }

  const goalHtml = `<div>
    <div class="salary-goal-card">
      <div class="salary-goal-label">هدف حقوق</div>
      <div class="salary-goal-value">${fmt(salaryGoal)} تومان</div>
      <div class="salary-bar" style="margin-top:8px"><span style="width:${goalPct}%"></span></div>
      <div class="salary-goal-sub">فعلی: ${fmt(last.total)} تومان، ${fa(goalPct)}٪ هدف</div>
    </div>
    ${teamAvg ? `<div class="salary-goal-card">
      <div class="salary-goal-label">مقایسه با تیم</div>
      <div class="salary-goal-value">${fa(Math.abs(teamDeltaPct))}٪ ${teamDeltaPct >= 0 ? 'بیشتر' : 'کمتر'}</div>
      <div class="salary-goal-sub">میانگین تیم: ${fmt(teamAvg)} تومان</div>
    </div>` : ''}
  </div>`;

  const slipPayload = (m) => encodeURIComponent(JSON.stringify({
    staff: `${t.name || ''} ${t.lname || ''}`.trim(),
    label: m.label,
    total: m.total || 0,
    paid: !!m.paid,
    paid_date: m.paid_date || '',
    fixed_salary: m.fixed_salary || 0,
    roles: m.roles || [],
  }));

  const timelineHtml = months.slice(-2).reverse().map(m => `<div class="salary-timeline-item">
    <div>
      <div class="salary-timeline-month">${escapeHtml(m.label)}</div>
      <div class="salary-timeline-status">${m.paid ? '✓ پرداخت شد' : 'در انتظار پرداخت'}</div>
    </div>
    <div>
      <div class="salary-timeline-amount">${fmt(m.total)} تومان</div>
      <button class="salary-slip-link" type="button" onclick="openSalarySlip('${slipPayload(m)}')">مشاهده فیش</button>
    </div>
  </div>`).join('');
  const reportTitle = `گزارش حقوق ${escapeHtml(t.name)} ${escapeHtml(t.lname)}`;
  const reportText = `${reportTitle}
حقوق این ماه: ${fmt(last.total)} تومان
تغییر نسبت به ماه قبل: ${prev ? `${pct > 0 ? '+' : ''}${fa(pct)}٪، ${fmt(Math.abs(diff))} تومان` : 'بدون سابقه'}
میانگین: ${fmt(avg)} تومان
وضعیت پرداخت: ${fa(paidCount)} از ${fa(months.length)} ماه پرداخت شده`;
  const encodedReportTitle = encodeURIComponent(reportTitle);
  const encodedReportText = encodeURIComponent(reportText);

  // ── Full month-by-month table (collapsible) ──
  const tableRows = months.slice().reverse().map((m, idx, arr) => {
    const p = arr[idx + 1];
    let changeBadge = '—', changeColor = 'var(--text3)';
    if (p) {
      const d = m.total - p.total;
      if (d > 0) { changeBadge = `▲ ${fmt(d)}`; changeColor = 'var(--green)'; }
      else if (d < 0) { changeBadge = `▼ ${fmt(-d)}`; changeColor = 'var(--red)'; }
      else changeBadge = '= بدون تغییر';
    }
    return `<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:4px 6px;font-weight:500">${escapeHtml(m.label)}</td>
      <td style="padding:4px 6px">${fmt(m.total)} تومان</td>
      <td style="padding:4px 6px;color:${changeColor};font-weight:600">${changeBadge}</td>
      <td style="padding:4px 6px">${m.paid ? '<span style="color:var(--green)">✓ پرداخت شد</span>' : '<span style="color:var(--text3)">در انتظار</span>'}</td>
      <td style="padding:4px 6px"><button class="salary-slip-link" type="button" onclick="openSalarySlip('${slipPayload(m)}')">مشاهده فیش</button></td>
    </tr>`;
  }).join('');

  return `<div class="trend-block" data-name="${escapeHtml(t.name)} ${escapeHtml(t.lname)}">
    <div class="salary-toolbar">
      <div class="salary-range-tabs" aria-label="بازه زمانی">
        ${['۳ ماه','۶ ماه','۱۲ ماه','همه'].map(x => `<button class="${x === rangeLabel ? 'active' : ''}" type="button">${x}</button>`).join('')}
      </div>
      <div class="salary-actions">
        <button class="salary-action-btn" type="button" onclick="window.print()">دانلود PDF</button>
        <button class="salary-action-btn" type="button" onclick="shareSalaryReport('${encodedReportText}')">اشتراک‌گذاری</button>
        <button class="salary-action-btn" type="button" onclick="emailSalaryReport('${encodedReportTitle}','${encodedReportText}')">ارسال ایمیل</button>
        <button class="salary-action-btn" type="button" onclick="window.print()">چاپ</button>
      </div>
    </div>

    <div class="salary-head">
      <div class="salary-who">
        <div class="salary-avatar">${(t.name || '؟').charAt(0)}</div>
        <div>
          <div class="salary-name">${escapeHtml(t.name)} ${escapeHtml(t.lname)}</div>
          <div class="salary-name-sub">پروفایل مالی پرسنل/عضو، پرداخت ${escapeHtml(last.label)}</div>
        </div>
      </div>
      <div class="salary-current">
        <div class="salary-current-kicker">حقوق این ماه</div>
        <div class="salary-current-amount">${fmt(last.total)} <span>تومان</span></div>
        ${changeHtml}
      </div>
    </div>

    ${changeHero}

    <div class="salary-chart-wrap">
      ${svg}
      <div class="salary-chart-labels">${chartLabels}</div>
    </div>

    <div class="salary-mini-stats">
      <div class="salary-mini-stat primary"><div class="salary-mini-label">بیشترین حقوق</div><div class="salary-mini-value">${fmt(maxV)}</div><div class="salary-mini-hint">▲ رکورد</div></div>
      <div class="salary-mini-stat"><div class="salary-mini-label">میانگین</div><div class="salary-mini-value">${fmt(avg)}</div></div>
      <div class="salary-mini-stat"><div class="salary-mini-label">مجموع پرداخت</div><div class="salary-mini-value">${fmt(totalPaid)}</div></div>
      <div class="salary-mini-stat"><div class="salary-mini-label">تعداد پرداخت</div><div class="salary-mini-value">${fa(paidCount)} از ${fa(months.length)} ماه</div></div>
    </div>

    <div class="salary-finance-grid">
      ${breakdownHtml}
      ${goalHtml}
    </div>

    ${insight}

    <div class="salary-timeline">${timelineHtml}</div>

    <details class="salary-details">
      <summary>مشاهده تاریخچه کامل</summary>
      <table style="width:100%;font-size:11px;border-collapse:collapse">
        <thead><tr style="color:var(--text3)"><th style="text-align:right;padding:3px 6px">ماه</th><th style="text-align:right;padding:3px 6px">حقوق کل</th><th style="text-align:right;padding:3px 6px">تغییر</th><th style="text-align:right;padding:3px 6px">وضعیت</th><th style="text-align:right;padding:3px 6px">فیش</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </details>
  </div>`;
}

// ── Add/Edit staff ────────────────────────────────────────────────────────────
function openAddStaffChoice(defaultType = '') {
  openModal('افزودن', `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <button type="button" onclick="closeModal();openStaffModal(null,'personnel')" style="text-align:right;border:1px solid rgba(124,106,247,.35);background:rgba(124,106,247,.12);border-radius:12px;padding:14px;color:var(--text);font-family:var(--font);cursor:pointer">
        <div style="font-size:15px;font-weight:900;margin-bottom:6px">پرسنل</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.8">کارمند یا نیروی اجرایی که نقش، چک‌لیست و گزارش عملکرد دارد.</div>
      </button>
      <button type="button" onclick="closeModal();openStaffModal(null,'member')" style="text-align:right;border:1px solid rgba(96,165,250,.35);background:rgba(96,165,250,.10);border-radius:12px;padding:14px;color:var(--text);font-family:var(--font);cursor:pointer">
        <div style="font-size:15px;font-weight:900;margin-bottom:6px">عضو</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.8">فرد یا طرف حساب پرداختی مثل صاحب دفتر، موجر یا همکار غیرپرسنلی.</div>
      </button>
    </div>
  `, [
    { label:'انصراف', cls:'btn-ghost', action:'closeModal()' },
  ]);
}

function openAddPersonnelFromTodo() {
  _staffReturnToTodoAfterSave = true;
  openStaffModal(null, 'personnel');
}

function openStaffModal(id = null, personType = 'personnel') {
  const editing = id !== null;
  refreshRolesAndOpenStaffModal(editing, id, personType);
}

async function openQuickStaffModal() {
  STAFF_ROLES = await window.api.staffRoles.getAll();
  openModal('⚡ افزودن سریع همکار', `
    <div style="background:rgba(124,106,247,.10);border:1px solid rgba(124,106,247,.22);border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px">ثبت سریع برای وقتی که فقط می‌خواهی همکار را وارد لیست کنی.</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.8">بعداً از گزینه تنظیمات همکاری می‌توانی نقش‌ها، یادآوری حقوق و جزئیات کامل را تکمیل کنی.</div>
    </div>
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">نام *</label>
        <input class="form-input" id="qst-name" placeholder="نام" autofocus>
      </div>
      <div class="form-group">
        <label class="form-label">نام خانوادگی</label>
        <input class="form-input" id="qst-lname" placeholder="نام خانوادگی">
      </div>
      <div class="form-group">
        <label class="form-label">شماره تماس</label>
        <input class="form-input" id="qst-phone" inputmode="tel" placeholder="مثلاً 0912...">
      </div>
      <div class="form-group">
        <label class="form-label">حقوق ثابت ماهانه</label>
        <input class="form-input amount-input" id="qst-salary" type="number" placeholder="اختیاری">
      </div>
      <div class="form-group full">
        <label class="form-label">شماره کارت</label>
        <input class="form-input" id="qst-card" style="direction:ltr;text-align:right" placeholder="اختیاری">
      </div>
    </div>
  `, [
    { label: 'افزودن سریع', cls: 'btn-primary', action: 'saveQuickStaff()' },
    { label: 'افزودن کامل به‌جایش', cls: 'btn-ghost', action: 'closeModal();openStaffModal()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  setTimeout(() => document.getElementById('qst-name')?.focus(), 80);
}

async function saveQuickStaff() {
  const name = document.getElementById('qst-name')?.value.trim();
  if (!name) { showToast('نام را وارد کنید', 'error'); return; }
  await window.api.staff.add({
    name,
    lname: document.getElementById('qst-lname')?.value || '',
    phone: document.getElementById('qst-phone')?.value || '',
    card_number: document.getElementById('qst-card')?.value || '',
    role_id: STAFF_ROLES[0]?.id,
    roles: [],
    salary: +(document.getElementById('qst-salary')?.value || 0),
    start_date: '',
    repeat_months: 0,
    note: 'ثبت سریع',
  });
  closeModal();
  showToast(`${name} سریع اضافه شد ✓`, 'success');
  await renderStaff();
}

function isStaffBonusRoleLabel(label) {
  return /پاداش|bonus/i.test(label || '');
}

function staffBonusItemsFromRole(role) {
  const saved = Array.isArray(role?.bonus_items) ? role.bonus_items : [];
  if (saved.length) return saved;
  const legacyAmount = (role?.amount || 0) * (role?.count ?? 1);
  return legacyAmount > 0 ? [{ amount: legacyAmount, note: '' }] : [{ amount: 0, note: '' }];
}

function staffBonusItemHtml(item = {}, disabled = false) {
  return `
    <div class="bonus-item">
      <div class="role-field">
        <label class="form-label">مبلغ پاداش</label>
        <input class="form-input bonus-amount amount-input" type="number" min="0" value="${item.amount || 0}" ${disabled ? 'disabled' : ''} oninput="updateStaffBonusTotal(this)">
      </div>
      <div class="role-field">
        <label class="form-label">دلیل / توضیحات</label>
        <input class="form-input bonus-note" value="${escapeHtml(item.note || '')}" ${disabled ? 'disabled' : ''} placeholder="مثلاً عملکرد عالی، جذب شاگرد، انجام پروژه...">
      </div>
      <button type="button" class="bonus-remove" onclick="removeStaffBonusItem(this)" title="حذف آیتم">×</button>
    </div>`;
}

async function refreshRolesAndOpenStaffModal(editing, id, personType = 'personnel') {
  STAFF_ROLES = await window.api.staffRoles.getAll();
  let s = null;
  if (editing) {
    const list = await window.api.staff.getAll();
    s = list.find(x => x.id === id);
  }
  const currentType = s?.person_type || personType || 'personnel';
  const isPersonnel = currentType === 'personnel';
  // Find existing reminder repeat setting for this staff member
  const allReminders = editing ? await window.api.staffReminders.getAll() : [];
  const existingRem = allReminders.find(r => r.staff_id === id);
  const currentRepeat = existingRem ? existingRem.repeat_months : (editing ? -1 : 1); // -1 = no reminder yet
  const roleRows = STAFF_ROLES.map(r => {
    const existing = (s?.roles || []).find(x => x.role_id === r.id);
    const checked = !!existing;
    const isBonus = isStaffBonusRoleLabel(r.label);
    const amt = existing?.amount || 0;
    const cnt = existing?.count ?? 1;
    const bonusItems = isBonus ? staffBonusItemsFromRole(existing) : [];
    const total = isBonus ? bonusItems.reduce((a, item) => a + (+(item.amount || 0)), 0) : amt * cnt;
    return `
    <div class="role-row ${isBonus ? 'staff-bonus-row' : ''}" data-role-label="${escapeHtml(r.label)}">
      <label class="role-row-label">
        <input type="checkbox" class="role-checkbox" data-role-id="${r.id}" ${checked?'checked':''}
          onchange="onRoleCheckChange(this)">
        <span>${escapeHtml(r.label)}</span>
      </label>
      ${isBonus ? `
      <details class="bonus-details" ${checked ? 'open' : ''}>
        <summary>
          آیتم‌های پاداش
          <button type="button" class="bonus-add-btn" onclick="event.preventDefault();event.stopPropagation();addStaffBonusItem(this)" title="افزودن پاداش">+</button>
          <span class="bonus-summary-amount">${fmt(total)} تومان</span>
        </summary>
        <div class="bonus-items">
          ${bonusItems.map(item => staffBonusItemHtml(item, !checked)).join('')}
        </div>
      </details>` : ''}
      <div class="role-row-fields">
        <div class="role-field">
          <label class="form-label">قیمت هر بار (تومان)</label>
          <input class="form-input role-amount" type="number" placeholder="0" value="${isBonus ? total : amt}" ${checked?'':'disabled'} ${isBonus ? 'readonly' : ''} oninput="updateRoleRowTotal(this)">
        </div>
        <div class="role-field role-field-sm">
          <label class="form-label">تعداد دفعات</label>
          <input class="form-input role-count" type="number" min="0" placeholder="1" value="${isBonus ? 1 : cnt}" ${checked?'':'disabled'} ${isBonus ? 'readonly' : ''} oninput="updateRoleRowTotal(this)">
        </div>
        <div class="role-field role-total-wrap">
          <label class="form-label">جمع کل این نقش</label>
          <div class="role-total-amount">${fmt(total)} تومان</div>
          <div class="role-total-words">${total>0?numberToPersianWords(total)+' تومان':''}</div>
        </div>
      </div>
    </div>`;
  }).join('');

  openModal(editing ? 'تنظیمات حساب' : (isPersonnel ? 'افزودن پرسنل' : 'افزودن عضو'), `
    ${!editing ? `<div style="background:rgba(124,106,247,.10);border:1px solid rgba(124,106,247,.22);border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px">${isPersonnel ? 'پرسنل برای نقش‌ها، چک‌لیست و گزارش عملکرد استفاده می‌شود.' : 'عضو فقط طرف حساب پرداختی است و وارد چک‌لیست پرسنل نمی‌شود.'}</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.8">برای افزودن فوری فقط نام را وارد کن و ذخیره بزن. اگر خواستی، شماره تماس، کارت، مبلغ پرداخت و یادآوری را هم تکمیل کن.</div>
    </div>` : ''}
    <input type="hidden" id="st-person-type" value="${currentType}">
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">نام *</label>
        <input class="form-input" id="st-name" value="${s?.name||''}">
      </div>
      <div class="form-group">
        <label class="form-label">نام خانوادگی</label>
        <input class="form-input" id="st-lname" value="${s?.lname||''}">
      </div>
      <div class="form-group">
        <label class="form-label">شماره تماس</label>
        <input class="form-input" id="st-phone" value="${s?.phone||''}">
      </div>
      <div class="form-group">
        <label class="form-label">ایمیل دسترسی</label>
        <input class="form-input" id="st-email" type="email" style="direction:ltr;text-align:left" value="${s?.email||''}" placeholder="برای لینک هم‌تیمی">
      </div>
      <div class="form-group">
        <label class="form-label">شماره کارت</label>
        <input class="form-input" id="st-card" style="direction:ltr;text-align:right" value="${s?.card_number||''}" placeholder="xxxx-xxxx-xxxx-xxxx">
      </div>
      <div class="form-group">
        <label class="form-label">حقوق ثابت ماهانه (تومان)</label>
        <input class="form-input amount-input" id="st-salary" type="number" value="${s?.salary||0}">
      </div>
      <div class="form-group">
        ${calendarDateFieldHtml('st-start', s?.start_date || '', 'تاریخ شروع همکاری')}
      </div>
      <div class="form-group full">
        <label class="form-label">زمان پرداخت حقوق</label>
        <select class="form-select" id="st-payment-timing">
          <option value="end" ${(s?.payment_timing||'end')==='end'?'selected':''}>پرداخت انتهای برج (پیش‌فرض)</option>
          <option value="start" ${s?.payment_timing==='start'?'selected':''}>پرداخت ابتدای برج</option>
        </select>
        <div style="font-size:10px;color:var(--text3);line-height:1.8;margin-top:4px">مثال: برای شروع همکاری در ۱۸ مرداد، پرداخت ابتدای برج سررسید را ۱۸ مرداد و پرداخت انتهای برج سررسید را ۱۸ شهریور ثبت می‌کند.</div>
      </div>
    </div>

    ${isPersonnel ? `
      <div class="form-section">نقش‌ها (این فرد ممکن است چند نقش داشته باشد)</div>
      <div id="staff-role-rows">
        ${roleRows}
      </div>
      <p style="font-size:11px;color:var(--text3);margin-top:6px">حقوق کل ماهانه = حقوق ثابت + جمع دستمزد نقش‌هایی که آن ماه فعال بوده‌اند.</p>
      <div class="modal-actions" style="justify-content:flex-start;margin-top:8px">
        <input class="form-input" id="st-newrole" placeholder="نقش جدید..." style="max-width:200px">
        <button class="btn btn-ghost btn-sm" onclick="addRoleInline()">+ افزودن نقش جدید</button>
      </div>
    ` : `
      <div class="form-section">پرداخت عضو</div>
      <p style="font-size:11px;color:var(--text3);line-height:1.8;margin-top:0">برای اعضای غیرپرسنل فقط مبلغ پرداخت ثابت/دوره‌ای، شماره کارت و یادآوری پرداخت استفاده می‌شود.</p>
      <div id="staff-role-rows" style="display:none"></div>
    `}

    <div class="form-section">🔁 تکرار یادآوری پرداخت حقوق</div>
    <select class="form-select" id="st-repeat">
      <option value="1" ${!editing || !currentRepeat ? 'selected' : ''}>هر ۱ ماه (ماهانه)</option>
      <option value="0" ${editing && currentRepeat === 0 ? 'selected' : ''}>بدون یادآوری</option>
    </select>
    ${editing ? `<p style="font-size:10px;color:var(--text3);margin-top:4px">اگر یادآوری وجود نداره، با ذخیره کردن به‌صورت خودکار ساخته می‌شه.</p>` : ''}
    <div class="form-group full" style="margin-top:8px">
      <textarea class="form-textarea" id="st-note" rows="2" placeholder="یادداشت / اطلاعات تکمیلی">${s?.note||''}</textarea>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: editing ? `saveStaffEdit(${id})` : 'saveStaffNew()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}

function onRoleCheckChange(checkbox) {
  const row = checkbox.closest('.role-row');
  row.querySelectorAll('.role-amount,.role-count,.bonus-amount,.bonus-note').forEach(el => el.disabled = !checkbox.checked);
  const bonusDetails = row.querySelector('.bonus-details');
  if (bonusDetails && checkbox.checked) bonusDetails.open = true;
  updateRoleRowTotal(row.querySelector('.role-amount'));
}

function updateRoleRowTotal(input) {
  const row = input.closest('.role-row');
  if (row.classList.contains('staff-bonus-row')) {
    updateStaffBonusTotal(row);
    return;
  }
  const amount = +(row.querySelector('.role-amount').value || 0);
  const count = +(row.querySelector('.role-count').value || 0);
  const total = amount * count;
  row.querySelector('.role-total-amount').textContent = `${fmt(total)} تومان`;
  row.querySelector('.role-total-words').textContent = total > 0 ? `${numberToPersianWords(total)} تومان` : '';
}

function updateStaffBonusTotal(elOrRow) {
  const row = elOrRow.closest ? elOrRow.closest('.role-row') : elOrRow;
  const total = [...row.querySelectorAll('.bonus-amount')].reduce((a, input) => a + (+(input.value || 0)), 0);
  const amount = row.querySelector('.role-amount');
  const count = row.querySelector('.role-count');
  if (amount) amount.value = total;
  if (count) count.value = 1;
  row.querySelector('.role-total-amount').textContent = `${fmt(total)} تومان`;
  row.querySelector('.role-total-words').textContent = total > 0 ? `${numberToPersianWords(total)} تومان` : '';
  const summaryAmount = row.querySelector('.bonus-summary-amount');
  if (summaryAmount) summaryAmount.textContent = `${fmt(total)} تومان`;
}

function addStaffBonusItem(button) {
  const row = button.closest('.role-row');
  const box = row.querySelector('.bonus-items');
  box.insertAdjacentHTML('beforeend', staffBonusItemHtml({}, !row.querySelector('.role-checkbox')?.checked));
  updateStaffBonusTotal(row);
  initAmountHints();
}

function removeStaffBonusItem(button) {
  const row = button.closest('.role-row');
  const items = row.querySelectorAll('.bonus-item');
  if (items.length <= 1) {
    const item = button.closest('.bonus-item');
    item.querySelector('.bonus-amount').value = 0;
    item.querySelector('.bonus-note').value = '';
  } else {
    button.closest('.bonus-item').remove();
  }
  updateStaffBonusTotal(row);
}

async function addRoleInline() {
  const label = document.getElementById('st-newrole')?.value.trim();
  if (!label) return;
  await window.api.staffRoles.add({ label });
  // Re-open modal preserving currently entered values is complex; simplest: refresh roles and re-render rows only
  STAFF_ROLES = await window.api.staffRoles.getAll();
  const newRole = STAFF_ROLES[STAFF_ROLES.length-1];
  const container = document.getElementById('staff-role-rows');
  const row = document.createElement('div');
  row.className = 'role-row';
  row.innerHTML = `
    <label class="role-row-label">
      <input type="checkbox" class="role-checkbox" data-role-id="${newRole.id}" checked onchange="onRoleCheckChange(this)">
      <span>${escapeHtml(newRole.label)}</span>
    </label>
    <div class="role-row-fields">
      <div class="role-field">
        <label class="form-label">قیمت هر بار (تومان)</label>
        <input class="form-input role-amount" type="number" placeholder="0" value="0" oninput="updateRoleRowTotal(this)">
      </div>
      <div class="role-field role-field-sm">
        <label class="form-label">تعداد دفعات</label>
        <input class="form-input role-count" type="number" min="0" placeholder="1" value="1" oninput="updateRoleRowTotal(this)">
      </div>
      <div class="role-field role-total-wrap">
        <label class="form-label">جمع کل این نقش</label>
        <div class="role-total-amount">۰ تومان</div>
        <div class="role-total-words"></div>
      </div>
    </div>`;
  container.appendChild(row);
  document.getElementById('st-newrole').value = '';
  initAmountHints();
  showToast('نقش اضافه شد ✓', 'success');
}

function collectStaffRoles() {
  const roles = [];
  document.querySelectorAll('#staff-role-rows .role-row').forEach(row => {
    const cb = row.querySelector('.role-checkbox');
    if (cb.checked) {
      if (row.classList.contains('staff-bonus-row')) {
        const bonusItems = [...row.querySelectorAll('.bonus-item')].map(item => ({
          amount: +(item.querySelector('.bonus-amount')?.value || 0),
          note: item.querySelector('.bonus-note')?.value || '',
        })).filter(item => item.amount > 0 || item.note.trim());
        const total = bonusItems.reduce((a, item) => a + item.amount, 0);
        roles.push({
          role_id: +cb.dataset.roleId,
          amount: total,
          count: 1,
          bonus_items: bonusItems.length ? bonusItems : [{ amount: 0, note: '' }],
        });
      } else {
        roles.push({
          role_id: +cb.dataset.roleId,
          amount: +(row.querySelector('.role-amount').value || 0),
          count: +(row.querySelector('.role-count').value || 0),
        });
      }
    }
  });
  return roles;
}

async function saveStaffNew() {
  const name = document.getElementById('st-name')?.value.trim();
  if (!name) { showToast('نام را وارد کنید', 'error'); return; }
  const personType = document.getElementById('st-person-type')?.value || 'personnel';
  const roles = collectStaffRoles();
  await window.api.staff.add({
    name, lname: document.getElementById('st-lname')?.value||'',
    phone: document.getElementById('st-phone')?.value||'',
    email: document.getElementById('st-email')?.value||'',
    card_number: document.getElementById('st-card')?.value||'',
    person_type: personType,
    role_id: roles[0]?.role_id || STAFF_ROLES[0]?.id,
    roles: personType === 'personnel' ? roles : [],
    salary: +(document.getElementById('st-salary')?.value||0),
    start_date: readCalendarDateField('st-start'),
    payment_timing: document.getElementById('st-payment-timing')?.value || 'end',
    repeat_months: +(document.getElementById('st-repeat')?.value||0),
    note: document.getElementById('st-note')?.value||'',
  });
  closeModal();
  showToast(`${name} اضافه شد ✓`, 'success');
  if (_staffReturnToTodoAfterSave) {
    _staffReturnToTodoAfterSave = false;
    currentPage = 'todolist';
    localStorage.setItem('tp_last_page', 'todolist');
    _todoActiveTab = _todoCanOpenStaffTasksTab() ? 'staff' : 'mine';
    updatePageTitle();
    renderTodoList();
  } else {
    await renderStaff();
  }
}

async function saveStaffEdit(id) {
  const name = document.getElementById('st-name')?.value.trim();
  if (!name) { showToast('نام را وارد کنید', 'error'); return; }
  const personType = document.getElementById('st-person-type')?.value || 'personnel';
  const roles = collectStaffRoles();
  const repeat = +(document.getElementById('st-repeat')?.value || 0);
  await window.api.staff.update({
    id, name, lname: document.getElementById('st-lname')?.value||'',
    phone: document.getElementById('st-phone')?.value||'',
    email: document.getElementById('st-email')?.value||'',
    card_number: document.getElementById('st-card')?.value||'',
    person_type: personType,
    role_id: roles[0]?.role_id || STAFF_ROLES[0]?.id,
    roles: personType === 'personnel' ? roles : [],
    salary: +(document.getElementById('st-salary')?.value||0),
    start_date: readCalendarDateField('st-start'),
    payment_timing: document.getElementById('st-payment-timing')?.value || 'end',
    note: document.getElementById('st-note')?.value||'',
    repeat_months: repeat, // pass to backend for reminder handling
  });
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  await renderStaff();
}

async function deleteStaff(id, name) {
  if (!confirm(`آیا مطمئنی "${name}" حذف شود؟ تمام سوابق پرداخت و ارزیابی او نیز حذف می‌شود.`)) return;
  await window.api.staff.delete(id);
  showToast('حذف شد', 'error');
  await renderStaff();
}

// ── Manage roles ──────────────────────────────────────────────────────────────
async function openManageRoles() {
  STAFF_ROLES = await window.api.staffRoles.getAll();
  openModal('🏷 مدیریت نقش‌ها', `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px">
      <button class="btn btn-ghost btn-sm" onclick="mergeDuplicateStaffRoles()">پاک‌سازی و ادغام نقش‌های تکراری</button>
    </div>
    <div class="settings-list" id="staff-roles-list">
      ${STAFF_ROLES.map(r => `
        <div class="settings-pkg-row">
          <input class="form-input" style="flex:1" value="${escapeHtml(r.label)}" onchange="updateStaffRole(${r.id}, this.value)">
          <button class="btn btn-danger btn-sm" onclick="deleteStaffRole(${r.id})">🗑</button>
        </div>`).join('')}
    </div>
    <div class="modal-actions" style="justify-content:flex-start;margin-top:12px">
      <input class="form-input" id="new-role-label" placeholder="نقش جدید" style="max-width:220px">
      <button class="btn btn-primary" onclick="addStaffRole()">+ افزودن</button>
    </div>
  `, [{ label: 'بستن', cls: 'btn-primary', action: 'closeModal()' }]);
}

async function addStaffRole() {
  const label = document.getElementById('new-role-label')?.value.trim();
  if (!label) return;
  await window.api.staffRoles.add({ label });
  await openManageRoles();
}
async function updateStaffRole(id, label) {
  const result=await window.api.staffRoles.update({ id, label });
  if(result.merged||result.retired){showToast(`${fa(result.merged+result.retired)} نقش با حفظ سوابق یکپارچه شد ✓`,'success');await openManageRoles();return;}
  showToast('ذخیره شد ✓', 'success');
}
async function mergeDuplicateStaffRoles() {
  if(!confirm('نقش‌های هم‌نام و نقش‌های بدون استفاده‌ای که از خدمات وارد شده‌اند یکپارچه شوند؟ تمام ارجاع‌ها و مبالغ حفظ می‌شوند و نسخه قبلی در آرشیو داخلی می‌ماند.'))return;
  const result=await window.api.staffRoles.mergeDuplicates();
  const total=Number(result.merged||0)+Number(result.retired||0);
  showToast(total?`${fa(total)} نقش یکپارچه و ${fa(result.reassigned||0)} ارجاع منتقل شد ✓`:'مورد تکراری یا اضافی پیدا نشد','success');
  await openManageRoles();
}
// ── اصلاح ماه یک رکورد حقوق ماهانه (وقتی پرداخت زودتر/دیرتر از موعد ثبت شده) ──
function openFixMonthlyMonth(monthlyId, staffId, name, curJy, curJm, returnToStaffPage = false) {
  const monthOptions = JMONTHS.map((mn, i) =>
    `<option value="${i+1}" ${i+1===curJm?'selected':''}>${mn}</option>`).join('');

  openModal(`✏️ اصلاح ماه رکورد حقوق — ${name}`, `
    <p style="font-size:12px;color:var(--text2);margin-bottom:10px">
      الان این رکورد به عنوان حقوق <b>${JMONTHS[curJm-1]} ${fa(curJy)}</b> ثبت شده.
      اگه اشتباه ثبت شده (مثلاً حقوق یه ماه دیگه رو زودتر پرداخت کردی)، اینجا ماه درست رو انتخاب کن.
    </p>
    <div class="form-group full">
      <label class="form-label">ماه صحیح</label>
      <div style="display:flex;gap:8px">
        <select class="form-input" id="fmm-month" style="flex:1.4">${monthOptions}</select>
        <input class="form-input" id="fmm-year" type="number" value="${curJy}" style="flex:1" placeholder="سال">
      </div>
    </div>
  `, [
    { label: 'ذخیره اصلاح', cls: 'btn-primary', action: `confirmFixMonthlyMonth(${monthlyId},${staffId},${escapeAttr(name)},${returnToStaffPage})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}
async function confirmFixMonthlyMonth(monthlyId, staffId, name, returnToStaffPage = false) {
  const jm = parseInt(document.getElementById('fmm-month')?.value);
  const jy = parseInt(document.getElementById('fmm-year')?.value);
  const res = await window.api.staffMonthly.updateMonth({ id: monthlyId, jy, jm });
  if (!res.ok) { showToast(res.error || 'خطا در اصلاح', 'error'); return; }
  closeModal();
  showToast('ماه رکورد اصلاح شد ✅', 'success');
  if (returnToStaffPage) await renderStaff();
  else await openStaffDetail(staffId);
}

async function deleteSalaryHistory(monthlyId) {
  if (!confirm('این رکورد از تاریخچه پرداخت‌های حقوق حذف شود؟')) return;
  await window.api.staffMonthly.delete(monthlyId);
  showToast('رکورد پرداخت حذف شد', 'error');
  await renderStaff();
}

async function deleteStaffRole(id) {
  const result = await window.api.staffRoles.delete(id);
  if (!result.ok) { showToast(result.error, 'error'); return; }
  await openManageRoles();
}

// ── Staff detail (performance dashboard) ──────────────────────────────────────
async function openStaffDetail(id) {
  const list = await window.api.staff.getAll();
  const s = list.find(x => x.id === id);
  if (!s) return;
  const payments = await window.api.staffPayments.getByStaff(id);
  const adjustments = await window.api.staffAdjustments.getByStaff(id);
  const monthly = await window.api.staffMonthly.getByStaff(id);

  const adjLabel = { bonus: '🎁 پاداش', penalty: '⚠️ جریمه', project: '📁 پروژه' };
  const adjColor = { bonus: 'var(--green)', penalty: 'var(--red)', project: 'var(--accent2)' };

  openModal(`📊 جزئیات و عملکرد — ${escapeHtml(s.name)} ${escapeHtml(s.lname)}`, `
    <div class="detail-section">
      <h3>اطلاعات پایه</h3>
      <div class="detail-row"><span class="detail-key">نقش‌ها</span><span class="detail-val">${(s.roles||[]).map(r=>r.role_label).join('، ')||'—'}</span></div>
      <div class="detail-row"><span class="detail-key">تلفن</span><span class="detail-val">${escapeHtml(s.phone||'—')}</span></div>
      <div class="detail-row"><span class="detail-key">شماره کارت</span><span class="detail-val" style="direction:ltr">${s.card_number||'—'}</span></div>
      <div class="detail-row"><span class="detail-key">حقوق ثابت ماهانه</span><span class="detail-val">${fmt(s.salary)} تومان</span></div>
      <div class="detail-row"><span class="detail-key">حقوق کل تخمینی این ماه</span><span class="detail-val" style="font-weight:700">${fmt(s.expectedMonthly)} تومان</span></div>
      <div class="detail-row"><span class="detail-key">یادداشت</span><span class="detail-val">${escapeHtml(s.note||'')||'—'}</span></div>
    </div>

    <div class="detail-section">
      <h3>💰 حقوق و دستمزد (پرداخت‌های آزاد) <button class="btn btn-ghost btn-sm" style="margin-right:8px" onclick="openStaffPayment(${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">+ ثبت پرداخت</button></h3>
      ${payments.length===0?'<p style="font-size:12px;color:var(--text3)">پرداختی ثبت نشده</p>':payments.slice(0,10).map(p=>`
        <div class="detail-row">
          <span class="detail-key">${DateService.disp(p.date_jalali)}${p.note?` — ${escapeHtml(p.note)}`:''}</span>
          <span class="detail-val amount-paid" style="display:flex;align-items:center;gap:6px">
            ${fmt(p.amount)} تومان
            <button class="btn btn-ghost btn-sm" onclick="openEditStaffPayment(${p.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteStaffPayment(${p.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">🗑</button>
          </span>
        </div>`).join('')}
    </div>

    <div class="detail-section">
      <h3>🎁 پاداش / ⚠️ جریمه / 📁 دستمزد پروژه <button class="btn btn-ghost btn-sm" style="margin-right:8px" onclick="openStaffAdjustment(${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">+ افزودن</button></h3>
      ${adjustments.length===0?'<p style="font-size:12px;color:var(--text3)">موردی ثبت نشده</p>':adjustments.slice(0,10).map(a=>`
        <div class="detail-row">
          <span class="detail-key">${DateService.disp(a.date_jalali)} — ${adjLabel[a.type]}${a.title?`: ${escapeHtml(a.title)}`:''}</span>
          <span class="detail-val" style="color:${adjColor[a.type]};display:flex;align-items:center;gap:6px">
            ${a.type==='penalty'?'-':'+'}${fmt(a.amount)} تومان
            <button class="btn btn-ghost btn-sm" onclick="openEditStaffAdjustment(${a.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">✏️</button>
            <button class="btn btn-danger btn-sm" onclick="deleteStaffAdjustment(${a.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">🗑</button>
          </span>
        </div>`).join('')}
    </div>

    <div class="detail-section">
      <h3>📅 گزارش حقوق ماه‌به‌ماه <button class="btn btn-ghost btn-sm" style="margin-right:8px" onclick="openStaffMonthly(${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">+ ثبت حقوق یک ماه</button></h3>
      <p style="font-size:11px;color:var(--text3);margin-bottom:6px">برای ثبت سوابق ماه‌های گذشته (مثلاً اردیبهشت، خرداد و...) از این بخش استفاده کن. روند صعودی/نزولی نسبت به ماه قبل نشان داده می‌شود.</p>
      ${monthly.length===0?'<p style="font-size:12px;color:var(--text3)">هنوز رکوردی ثبت نشده</p>':monthly.map(m=>{
        let trendBadge = '';
        if (m.trend !== null) {
          if (m.trend > 0) trendBadge = `<span style="color:var(--green);font-size:11px">▲ ${fmt(m.trend)}</span>`;
          else if (m.trend < 0) trendBadge = `<span style="color:var(--red);font-size:11px">▼ ${fmt(-m.trend)}</span>`;
          else trendBadge = `<span style="color:var(--text3);font-size:11px">= بدون تغییر</span>`;
        }
        return `
        <div class="detail-row">
          <span class="detail-key">
            ${escapeHtml(m.label)} ${trendBadge}${m.paid?' <span class="status status-ok" style="margin-right:4px">پرداخت‌شده</span>':''}
            ${m.roles && m.roles.length ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${m.roles.map(r=>`${escapeHtml(r.role_label)}: ${fa(r.count||1)}×${fmt(r.rate||r.amount||0)}=${fmt(r.amount)}`).join(' | ')}</div>` : ''}
          </span>
          <span class="detail-val" style="display:flex;align-items:center;gap:6px">
            ${fmt(m.total)} تومان
            ${!m.paid?`<button class="btn btn-primary btn-sm" onclick="markMonthlyPaid(${m.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">✓ پرداخت شد</button>`:''}
            <button class="btn btn-ghost btn-sm" onclick="openFixMonthlyMonth(${m.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))}, ${m.jy}, ${m.jm})">✏️ اصلاح ماه</button>
            <button class="btn btn-danger btn-sm" onclick="deleteMonthly(${m.id}, ${id}, ${escapeAttr((s.name) + ' ' + (s.lname))})">🗑</button>
          </span>
        </div>`;
      }).join('')}
    </div>
  `, [
    { label: 'بستن', cls: 'btn-primary', action: 'closeModal()' },
  ]);
}

async function openEditStaffPayment(id, staffId, name) {
  const payments = await window.api.staffPayments.getByStaff(staffId);
  const p = payments.find(x => x.id === id);
  if (!p) return;
  openModal(`✏️ ویرایش پرداخت — ${name}`, `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">مبلغ (تومان)</label>
        <input class="form-input amount-input" id="esp-amount" type="number" value="${p.amount}">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی)</label>
        <input class="form-input jdate" id="esp-date" value="${p.date_jalali}">
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="esp-note" value="${escapeHtml(p.note||'')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditStaffPayment(${id}, ${staffId}, ${escapeAttr(name)})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function saveEditStaffPayment(id, staffId, name) {
  await window.api.staffPayments.update({
    id, amount: +(document.getElementById('esp-amount')?.value||0),
    date: document.getElementById('esp-date')?.value,
    note: document.getElementById('esp-note')?.value,
  });
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  await openStaffDetail(staffId);
}
async function deleteStaffPayment(id, staffId, name) {
  if (!confirm('این پرداخت حذف شود؟')) return;
  await window.api.staffPayments.delete(id);
  showToast('حذف شد', 'error');
  await openStaffDetail(staffId);
}

async function openEditStaffAdjustment(id, staffId, name) {
  const adjustments = await window.api.staffAdjustments.getByStaff(staffId);
  const a = adjustments.find(x => x.id === id);
  if (!a) return;
  openModal(`✏️ ویرایش — ${name}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">نوع</label>
        <select class="form-select" id="esa-type">
          <option value="bonus" ${a.type==='bonus'?'selected':''}>🎁 پاداش</option>
          <option value="penalty" ${a.type==='penalty'?'selected':''}>⚠️ جریمه</option>
          <option value="project" ${a.type==='project'?'selected':''}>📁 دستمزد پروژه</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="esa-title" value="${escapeHtml(a.title||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ (تومان)</label>
        <input class="form-input amount-input" id="esa-amount" type="number" value="${a.amount}">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی)</label>
        <input class="form-input jdate" id="esa-date" value="${a.date_jalali}">
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="esa-note" value="${escapeHtml(a.note||'')}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditStaffAdjustment(${id}, ${staffId}, ${escapeAttr(name)})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function saveEditStaffAdjustment(id, staffId, name) {
  await window.api.staffAdjustments.update({
    id, type: document.getElementById('esa-type')?.value,
    title: document.getElementById('esa-title')?.value,
    amount: +(document.getElementById('esa-amount')?.value||0),
    date: document.getElementById('esa-date')?.value,
    note: document.getElementById('esa-note')?.value,
  });
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  await openStaffDetail(staffId);
}
async function deleteStaffAdjustment(id, staffId, name) {
  if (!confirm('این مورد حذف شود؟')) return;
  await window.api.staffAdjustments.delete(id);
  showToast('حذف شد', 'error');
  await openStaffDetail(staffId);
}

// ── Staff: register payment ────────────────────────────────────────────────
function openStaffPayment(staffId, name) {
  openModal(`💳 ثبت پرداخت حقوق — ${name}`, `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">مبلغ (تومان) *</label>
        <input class="form-input amount-input" id="sp-amount" type="number">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی)</label>
        <input class="form-input jdate" id="sp-date" value="${formatJalali(...todayJalali())}">
      </div>
      <div class="form-group full">
        <label class="form-label">پرداخت از حساب</label>
        <select class="form-select" id="sp-account">${financialAccountOptionsHtml()}</select>
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="sp-note" placeholder="مثلاً: حقوق خرداد">
      </div>
    </div>
  `, [
    { label: 'ثبت', cls: 'btn-primary', action: `saveStaffPayment(${staffId})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function saveStaffPayment(staffId) {
  const amount = +(document.getElementById('sp-amount')?.value||0);
  if (!amount) { showToast('مبلغ را وارد کنید', 'error'); return; }
  await window.api.staffPayments.add({ staff_id: staffId, amount, date: document.getElementById('sp-date')?.value, account_id: document.getElementById('sp-account')?.value||null, note: document.getElementById('sp-note')?.value });
  closeModal();
  showToast('ثبت شد ✓', 'success');
  await openStaffDetail(staffId);
}

// ── Staff: bonus/penalty/project ──────────────────────────────────────────────
function openStaffAdjustment(staffId, name) {
  openModal(`🎁/⚠️/📁 پاداش، جریمه یا دستمزد پروژه — ${name}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">نوع</label>
        <select class="form-select" id="sa-type">
          <option value="bonus">🎁 پاداش</option>
          <option value="penalty">⚠️ جریمه</option>
          <option value="project">📁 دستمزد پروژه (مثلاً پروژه منیجر، ادیت ویدیو، سئو، پاسخگویی...)</option>
        </select>
      </div>
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="sa-title" placeholder="مثلاً: پروژه ادیت ویدیو محصول جدید">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ (تومان) *</label>
        <input class="form-input amount-input" id="sa-amount" type="number">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ (شمسی)</label>
        <input class="form-input jdate" id="sa-date" value="${formatJalali(...todayJalali())}">
      </div>
      <div class="form-group full">
        <label class="form-label">یادداشت</label>
        <input class="form-input" id="sa-note">
      </div>
    </div>
  `, [
    { label: 'ثبت', cls: 'btn-primary', action: `saveStaffAdjustment(${staffId})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function saveStaffAdjustment(staffId) {
  const amount = +(document.getElementById('sa-amount')?.value||0);
  if (!amount) { showToast('مبلغ را وارد کنید', 'error'); return; }
  await window.api.staffAdjustments.add({
    staff_id: staffId, type: document.getElementById('sa-type')?.value,
    title: document.getElementById('sa-title')?.value,
    amount, date: document.getElementById('sa-date')?.value,
    note: document.getElementById('sa-note')?.value,
  });
  closeModal();
  showToast('ثبت شد ✓', 'success');
  await openStaffDetail(staffId);
}

// ── Staff: monthly salary record (backfill past months + trend) ─────────────────
async function openStaffMonthly(staffId, name) {
  const list = await window.api.staff.getAll();
  const s = list.find(x => x.id === staffId);
  const [tjy, tjm] = todayJalali();

  const roleRows = (s.roles||[]).map(r => `
    <div class="role-row" style="align-items:flex-end">
      <span style="min-width:100px;font-size:13px">${escapeHtml(r.role_label)}</span>
      <div style="flex:1">
        <label class="form-label">دستمزد هر بار (تومان)</label>
        <input class="form-input amount-input sm-role-rate" data-role-id="${r.role_id}" data-role-label="${escapeHtml(r.role_label)}" type="number" value="${r.amount||0}">
      </div>
      <div style="flex:1">
        <label class="form-label">تعداد دفعات در این ماه</label>
        <input class="form-input sm-role-count" type="number" min="0" value="${r.count ?? 1}">
      </div>
      <div style="flex:1;font-size:11px;color:var(--text2)">
        جمع: <span class="sm-role-total">${fmt((r.amount||0)*(r.count??1))}</span> تومان
      </div>
    </div>`).join('');

  openModal(`📅 ثبت حقوق یک ماه — ${name}`, `
    <div class="form-grid">
      <div class="form-group">
        <label class="form-label">ماه</label>
        <select class="form-select" id="sm-month">
          ${JMONTHS.map((m,i)=>`<option value="${i+1}" ${i+1===tjm?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">سال (شمسی)</label>
        <input class="form-input" id="sm-year" type="number" value="${fa(tjy).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d))}" dir="ltr">
      </div>
      <div class="form-group full">
        <label class="form-label">حقوق ثابت این ماه (تومان)</label>
        <input class="form-input amount-input" id="sm-fixed" type="number" value="${s.salary||0}">
      </div>
    </div>
    ${roleRows ? `<div class="form-section">دستمزد نقش‌ها در این ماه</div>${roleRows}` : ''}
    <label class="pkg-check" style="width:100%;margin-top:10px" onclick="this.classList.toggle('checked'); this.querySelector('input').checked = this.classList.contains('checked')">
      <input type="checkbox" id="sm-paid"> این ماه پرداخت شده است
    </label>
    <div class="form-group full" id="sm-paid-date-wrap" style="display:none;margin-top:8px">
      <label class="form-label">تاریخ پرداخت (شمسی)</label>
      <input class="form-input jdate" id="sm-paid-date" value="${formatJalali(...todayJalali())}">
    </div>
  `, [
    { label: 'ثبت', cls: 'btn-primary', action: `saveStaffMonthly(${staffId}, ${escapeAttr(name)})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
  initAmountHints();
  document.getElementById('sm-paid').parentElement.addEventListener('click', () => {
    setTimeout(() => {
      document.getElementById('sm-paid-date-wrap').style.display = document.getElementById('sm-paid').checked ? 'block' : 'none';
    }, 0);
  });
  document.querySelectorAll('.role-row').forEach(row => {
    const rate = row.querySelector('.sm-role-rate');
    const count = row.querySelector('.sm-role-count');
    const totalEl = row.querySelector('.sm-role-total');
    if (!rate || !count) return;
    const update = () => { totalEl.textContent = fmt((+rate.value||0) * (+count.value||0)); };
    rate.addEventListener('input', update);
    count.addEventListener('input', update);
  });
}

async function saveStaffMonthly(staffId, name) {
  const roles = [...document.querySelectorAll('.sm-role-rate')].map(el => {
    const row = el.closest('.role-row');
    return {
      role_id: +el.dataset.roleId,
      rate: +(el.value || 0),
      count: +(row.querySelector('.sm-role-count').value || 0),
    };
  });
  await window.api.staffMonthly.add({
    staff_id: staffId,
    jy: +(document.getElementById('sm-year')?.value || 0),
    jm: +(document.getElementById('sm-month')?.value || 1),
    fixed_salary: +(document.getElementById('sm-fixed')?.value || 0),
    roles,
    mark_paid: document.getElementById('sm-paid')?.checked,
    paid_date: document.getElementById('sm-paid-date')?.value,
  });
  closeModal();
  showToast('ثبت شد ✓', 'success');
  await openStaffDetail(staffId);
}

async function markMonthlyPaid(monthlyId, staffId, name) {
  openModal(`✓ تأیید پرداخت — ${name}`, `
    <div class="form-group full">
      <label class="form-label">تاریخ پرداخت (شمسی)</label>
      <input class="form-input jdate" id="mp-date" value="${formatJalali(...todayJalali())}">
    </div>
  `, [
    { label: 'ثبت پرداخت', cls: 'btn-primary', action: `confirmMonthlyPaid(${monthlyId}, ${staffId})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function confirmMonthlyPaid(monthlyId, staffId) {
  await window.api.staffMonthly.markPaid({ id: monthlyId, date: document.getElementById('mp-date')?.value });
  closeModal();
  showToast('ثبت شد ✓', 'success');
  await openStaffDetail(staffId);
}

async function deleteMonthly(monthlyId, staffId, name) {
  if (!confirm('این رکورد حقوق ماهانه حذف شود؟')) return;
  await window.api.staffMonthly.delete(monthlyId);
  showToast('حذف شد', 'error');
  await openStaffDetail(staffId);
}

// ── Salary Transfer Helper (واریز حقوق) ──────────────────────────────────────
async function openSalaryTransfer(staffId) {
  const list = await window.api.staff.getAll();
  const s = list.find(x => x.id === staffId);
  if (!s) return;

  if (!s.card_number) {
    showToast('شماره کارت این همکار ثبت نشده. ابتدا از بخش تنظیمات همکاری، شماره کارت را وارد کنید.', 'error');
    return;
  }

  // Compute total for this month: salary + active roles + bonuses - penalties this month
  const [tjy, tjm] = todayJalali();
  const adjustments = await window.api.staffAdjustments.getByStaff(staffId);
  const monthAdj = adjustments.filter(a => {
    const parts = a.date_jalali.split('/');
    return +parts[0] === tjy && +parts[1] === tjm;
  }).reduce((sum, a) => sum + (a.type === 'penalty' ? -(a.amount||0) : (a.amount||0)), 0);

  const baseSalary = s.expectedMonthly;
  const totalToman = baseSalary + monthAdj;
  const totalRial = totalToman * 10;

  const cardFormatted = (s.card_number || '').replace(/\D/g, '').replace(/(.{4})/g, '$1-').replace(/-$/, '');
  const monthName = JMONTHS[tjm - 1];

  openModal(`💳 واریز حقوق — ${escapeHtml(s.name)} ${escapeHtml(s.lname)}`, `
    <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:16px 20px;margin-bottom:12px">
      <div style="font-size:11px;color:var(--text3);margin-bottom:4px">نام همکار</div>
      <div style="font-size:15px;font-weight:700">${escapeHtml(s.name)} ${escapeHtml(s.lname)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">شماره کارت</div>
        <div style="font-size:15px;font-weight:700;letter-spacing:2px;direction:ltr;text-align:right;color:var(--accent2)">${cardFormatted}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%" onclick="copyToClipboard('${(s.card_number||'').replace(/\D/g,'')}', 'شماره کارت کپی شد ✓')">📋 کپی شماره کارت</button>
      </div>
      <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:12px;padding:14px 16px">
        <div style="font-size:11px;color:var(--text3);margin-bottom:6px">مبلغ واریزی (ریال)</div>
        <div style="font-size:15px;font-weight:700;color:var(--green)">${fmt(totalRial)}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%" onclick="copyToClipboard('${totalRial}', 'مبلغ به ریال کپی شد ✓')">📋 کپی مبلغ (ریال)</button>
      </div>
    </div>

    <div style="background:var(--bg3);border:1px solid var(--border2);border-radius:10px;padding:12px 16px;font-size:12px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:var(--text3)">حقوق پایه ${monthName}</span>
        <span>${fmt(baseSalary)} تومان</span>
      </div>
      ${monthAdj !== 0 ? `
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="color:var(--text3)">پاداش/جریمه این ماه</span>
        <span style="color:${monthAdj>0?'var(--green)':'var(--red)'}">${monthAdj>0?'+':''}${fmt(monthAdj)} تومان</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;border-top:1px solid var(--border2);padding-top:6px;margin-top:6px;font-weight:700">
        <span>جمع قابل پرداخت</span>
        <span style="color:var(--green)">${fmt(totalToman)} تومان = ${fmt(totalRial)} ریال</span>
      </div>
    </div>

    <button class="btn btn-primary" style="width:100%;font-size:14px;padding:12px;background:var(--green);border-color:var(--green)" onclick="openBankTransfer()">
      🏦 رفتن به اینترنت‌بانک ملت
    </button>
    <p style="font-size:10px;color:var(--text3);text-align:center;margin-top:6px">شماره کارت و مبلغ را کپی کنید، سپس در اینترنت‌بانک paste کنید</p>
  `, [
    { label: 'بستن', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}

// ── Row kebab menus (staff / reminders tables) ────────────────────────────
/* ── Portal dropdown system ──────────────────────────────────────────────
   منو در <body> رندر می‌شود و با position:fixed از هر overflow/clip آزاد است.
   مشابه رویکرد Radix UI / Material UI / Ant Design.
   ────────────────────────────────────────────────────────────────────── */
(function () {
  // Create the single portal element once
  const portal = document.createElement('div');
  portal.id = 'row-menu-portal';
  if (document.body) document.body.appendChild(portal);
  else document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(portal); });

  let _currentMenuId = null; // which logical menu is open
  let _sourcePanel = null;   // original panel whose children were moved into the portal

  function closePortal() {
    if (_sourcePanel) {
      while (portal.firstChild) _sourcePanel.appendChild(portal.firstChild);
      _sourcePanel = null;
    } else {
      portal.innerHTML = '';
    }
    portal.classList.remove('open');
    _currentMenuId = null;
  }

  // Close after a menu action. Capture so stopPropagation on items cannot skip it.
  portal.addEventListener('click', function (event) {
    if (event.target.closest('.row-menu-item')) setTimeout(closePortal, 0);
  }, true);

  // Close on outside click
  document.addEventListener('click', closePortal);
  // Close on scroll (keeps portal aligned)
  document.addEventListener('scroll', closePortal, true);

  window.toggleRowMenu = function (ev, menuId) {
    ev.stopPropagation();

    // If the same menu is already open → just close
    if (_currentMenuId === menuId) { closePortal(); return; }

    closePortal();

    // Find the hidden source panel
    const source = document.getElementById(menuId);
    if (!source) return;

    // Move the original nodes (with CSP-bound listeners) into the portal.
    // Cloning via innerHTML drops those listeners, so Delete/Edit would no-op.
    while (source.firstChild) portal.appendChild(source.firstChild);
    _sourcePanel = source;
    _currentMenuId = menuId;

    // Position: align portal below the button that was clicked
    const btn = ev.currentTarget;
    const rect = btn.getBoundingClientRect();
    const MARGIN = 4;

    portal.classList.add('open'); // make visible so we can measure
    const pw = portal.offsetWidth;
    const ph = portal.offsetHeight;

    // RTL: prefer opening to the right (towards start of line)
    // Flip left if it would overflow the viewport
    let left = rect.right - pw;
    if (left < 8) left = rect.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;

    let top = rect.bottom + MARGIN;
    // Flip upward if not enough space below
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - MARGIN;

    portal.style.top  = top  + 'px';
    portal.style.left = left + 'px';
  };
})();

// ── Masked card number for table display (e.g. 6037 •••• •••• 0534) ──────
function maskCardNumber(num) {
  if (!num) return '—';
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 8) return num;
  return digits.slice(0, 4) + ' •••• •••• ' + digits.slice(-4);
}

function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg || 'کپی شد ✓', 'success');
  }).catch(() => {
    // Fallback for Electron
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast(successMsg || 'کپی شد ✓', 'success');
  });
}

async function shareSalaryReport(encodedText) {
  const text = decodeURIComponent(encodedText || '');
  try {
    if (navigator.share) {
      await navigator.share({ title: 'گزارش حقوق TeamPulse', text });
      showToast('گزارش آماده اشتراک‌گذاری شد ✓', 'success');
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  copyToClipboard(text, 'متن گزارش کپی شد ✓');
}

function emailSalaryReport(encodedSubject, encodedBody) {
  window.location.href = `mailto:?subject=${encodedSubject || ''}&body=${encodedBody || ''}`;
}

function openSalarySlip(encodedPayload) {
  let slip = null;
  try {
    slip = JSON.parse(decodeURIComponent(encodedPayload || ''));
  } catch (e) {
    showToast('فیش حقوقی باز نشد', 'error');
    return;
  }
  const roles = slip.roles || [];
  const base = slip.fixed_salary || 0;
  const rolesTotal = roles.reduce((sum, r) => sum + (r.amount || 0), 0);
  const rows = [
    base ? `<div class="detail-row"><span class="detail-key">حقوق پایه</span><span class="detail-val">${fmt(base)} تومان</span></div>` : '',
    ...roles.map(r => `<div class="detail-row"><span class="detail-key">${escapeHtml(r.role_label || 'مزایا')}</span><span class="detail-val">${fmt(r.amount || 0)} تومان</span></div>`),
    !roles.some(r => /پاداش|bonus/i.test(r.role_label || '')) ? `<div class="detail-row"><span class="detail-key">پاداش</span><span class="detail-val">—</span></div>` : '',
    `<div class="detail-row"><span class="detail-key">کسورات</span><span class="detail-val">—</span></div>`,
  ].filter(Boolean).join('');

  openModal(`فیش حقوقی — ${escapeHtml(slip.label || '')}`, `
    <div class="detail-section">
      <h3>${escapeHtml(slip.staff || 'همکار')}</h3>
      <div class="detail-row"><span class="detail-key">ماه</span><span class="detail-val">${escapeHtml(slip.label || '—')}</span></div>
      <div class="detail-row"><span class="detail-key">وضعیت پرداخت</span><span class="detail-val" style="color:${slip.paid ? 'var(--green)' : 'var(--text3)'}">${slip.paid ? '✓ پرداخت شد' : 'در انتظار پرداخت'}</span></div>
      ${slip.paid_date ? `<div class="detail-row"><span class="detail-key">تاریخ پرداخت</span><span class="detail-val">${escapeHtml(slip.paid_date)}</span></div>` : ''}
    </div>
    <div class="detail-section">
      <h3>ریز فیش</h3>
      ${rows}
      <div class="detail-row" style="border-top:1px solid var(--border);margin-top:8px;padding-top:10px">
        <span class="detail-key" style="font-weight:800;color:var(--text)">جمع کل</span>
        <span class="detail-val" style="font-size:16px;font-weight:900">${fmt(slip.total || base + rolesTotal)} تومان</span>
      </div>
    </div>
  `, [
    { label: 'چاپ', cls: 'btn-ghost', action: 'window.print()' },
    { label: 'بستن', cls: 'btn-primary', action: 'closeModal()' },
  ]);
}

function openBankTransfer() {
  window.api.openExternal('https://ebanking.bankmellat.ir/ebanking/#/');
}


async function payStaffSalary(staffId, name) {
  const list = await window.api.staff.getAll();
  const s = list.find(x => x.id === staffId);
  const reminders = await window.api.staffReminders.getAll();
  const rem = reminders.find(r => r.staff_id === staffId);

  // پیش‌فرض سال: سال فعلی. ماه: ماه سررسید یادآوری (نه لزوماً ماه امروز)
  const [curJy, curJm] = todayJalali();
  let defJy = curJy;
  let defJm = curJm;
  if (rem && rem.due_date_jalali) {
    const parts = parseJalali(rem.due_date_jalali) || rem.due_date_jalali.split('/').map(Number);
    if (parts[1]) defJm = parts[1];
  }

  const monthOptions = JMONTHS.map((mn, i) =>
    `<option value="${i+1}" ${i+1===defJm?'selected':''}>${mn}</option>`).join('');

  openModal(`✓ تأیید پرداخت حقوق — ${name}`, `
    <p style="font-size:12px;color:var(--text2);margin-bottom:8px">حقوق کل این ماه: <b>${fmt(s.expectedMonthly)} تومان</b> (حقوق ثابت + نقش‌ها × تعداد)</p>

    <div class="form-group full">
      <label class="form-label">تاریخ واقعی پرداخت (شمسی)</label>
      <input class="form-input jdate" id="psp-date" value="${formatJalali(...todayJalali())}">
      <div style="font-size:10px;color:var(--text3);margin-top:3px">یعنی امروز چه زمانی پول رو واریز کردی — حتی اگه زودتر یا دیرتر از موعد باشه</div>
    </div>

    <div class="form-group full" style="margin-top:10px">
      <label class="form-label">این پرداخت برای حقوق کدوم ماه است؟ ⚠️</label>
      <div style="display:flex;gap:8px">
        <select class="form-input" id="psp-month" style="flex:1.4">${monthOptions}</select>
        <input class="form-input" id="psp-year" type="number" value="${defJy}" style="flex:1" placeholder="سال">
      </div>
      <div style="font-size:10px;color:var(--amber);margin-top:3px">
        💡 اگه زودتر از موعد پرداخت می‌کنی (مثلاً حقوق تیر رو در خرداد می‌دی)، اینجا «تیر» رو انتخاب کن — نه ماهی که الان توشی.
      </div>
    </div>

    <div class="form-group full" style="margin-top:10px">
      <label class="form-label">پرداخت از حساب</label>
      <select class="form-select" id="psp-account">${financialAccountOptionsHtml()}</select>
      <div style="font-size:10px;color:var(--text3);margin-top:3px">با انتخاب حساب، خروج وجه و هزینه «حقوق و دستمزد» خودکار ثبت می‌شود.</div>
    </div>

    <p style="font-size:11px;color:var(--text3);margin-top:10px">پس از تأیید: این مبلغ در تاریخچه پرداخت‌ها ثبت می‌شود، یادآوری ماه بعد تنظیم می‌شود و تعداد دفعات نقش‌ها برای ورود اطلاعات ماه جدید صفر می‌شود.</p>
  `, [
    { label: 'تأیید پرداخت', cls: 'btn-primary', action: `confirmPayStaffSalary(${staffId})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function confirmPayStaffSalary(staffId) {
  const forMonth = parseInt(document.getElementById('psp-month')?.value);
  const forYear = parseInt(document.getElementById('psp-year')?.value);
  await window.api.staff.paySalary({
    staff_id: staffId,
    date: document.getElementById('psp-date')?.value,
    account_id: document.getElementById('psp-account')?.value||null,
    for_jy: forYear,
    for_jm: forMonth,
  });
  closeModal();
  showToast('پرداخت ثبت شد ✓', 'success');
  await renderStaff();
}

let _staffReminderDateRowSeq = 0;

function _staffReminderRepeatOptions(selected = 1) {
  const opts = [
    [0, 'بدون تکرار'],
    [1, 'هر ۱ ماه'],
    [2, 'هر ۲ ماه'],
    [3, 'هر ۳ ماه'],
    [6, 'هر ۶ ماه'],
    [12, 'هر ۱۲ ماه'],
    ['custom', 'دوره دلخواه'],
  ];
  const isCustom = selected !== 'custom' && ![0,1,2,3,6,12].includes(+selected);
  return opts.map(([v, label]) => `<option value="${v}" ${(isCustom && v === 'custom') || String(selected) === String(v) ? 'selected' : ''}>${label}</option>`).join('');
}

function _syncStaffReminderRepeatCustom(prefix = 'sr') {
  const select = document.getElementById(prefix + '-repeat');
  const wrap = document.getElementById(prefix + '-repeat-custom-wrap');
  if (wrap) wrap.style.display = select?.value === 'custom' ? 'block' : 'none';
}

function _readStaffReminderRepeat(prefix = 'sr') {
  const select = document.getElementById(prefix + '-repeat');
  if (select?.value === 'custom') return Math.max(0, +(document.getElementById(prefix + '-repeat-custom')?.value || 0));
  return +(select?.value || 0);
}

function _staffReminderDateRowHtml(idx, value) {
  return `
    <div class="staff-reminder-date-row" data-index="${idx}" style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;background:var(--bg3);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
      <div>${calendarDateFieldHtml('sr-date-' + idx, value || formatJalali(...todayJalali()), 'تاریخ سررسید')}</div>
      <button type="button" class="btn btn-ghost btn-sm" onclick="_removeStaffReminderDateRow(this)" title="حذف تاریخ">×</button>
    </div>`;
}

function _addStaffReminderDateRow(value) {
  const box = document.getElementById('sr-dates');
  if (!box) return;
  const idx = ++_staffReminderDateRowSeq;
  box.insertAdjacentHTML('beforeend', _staffReminderDateRowHtml(idx, value));
  initDatePickers && initDatePickers();
}

function _removeStaffReminderDateRow(btn) {
  const row = btn.closest('.staff-reminder-date-row');
  const box = document.getElementById('sr-dates');
  if (!row || !box) return;
  if (box.querySelectorAll('.staff-reminder-date-row').length <= 1) {
    showToast('حداقل یک تاریخ لازم است', 'error');
    return;
  }
  row.remove();
}

function _syncStaffReminderAmountFromStaff() {
  const staffId = +(document.getElementById('sr-staff')?.value || 0);
  const staff = (window._staffReminderStaffList || []).find(s => s.id === staffId);
  const amount = document.getElementById('sr-amount');
  if (amount && staff && !amount.value) amount.value = staff.expectedMonthly || 0;
}

async function openAddStaffReminder() {
  const staffList = await window.api.staff.getAll();
  window._staffReminderStaffList = staffList;
  _staffReminderDateRowSeq = 0;
  const staffOptions = staffList.map((s, i) =>
    `<option value="${s.id}" ${i === 0 ? 'selected' : ''}>${escapeHtml((s.name + ' ' + (s.lname || '')).trim())} — ${fmt(s.expectedMonthly || 0)} تومان</option>`
  ).join('') || '<option value="">هنوز همکاری ثبت نشده</option>';
  const defaultAmount = staffList[0]?.expectedMonthly || 0;
  openModal('⏰ افزودن یادآوری پرداخت حقوق', `
    <div style="background:rgba(124,106,247,.10);border:1px solid rgba(124,106,247,.22);border-radius:12px;padding:12px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:800;color:var(--text);margin-bottom:4px">برای یک همکار، هر تعداد تاریخ لازم داری بساز.</div>
      <div style="font-size:11px;color:var(--text3);line-height:1.8">هر تاریخ به‌صورت یک یادآوری جدا ثبت می‌شود؛ اگر تکرار انتخاب شود، بعد از پرداخت، سررسید بعدی خودش ساخته می‌شود.</div>
    </div>
    <div style="border:1px dashed var(--border2);border-radius:12px;padding:10px;margin-bottom:12px;background:rgba(31,37,56,.42)">
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px">
        <div>
          <div style="font-size:12px;font-weight:800;color:var(--text)">همکار موردنظرت در لیست نیست؟</div>
          <div style="font-size:10.5px;color:var(--text3);margin-top:3px">همین‌جا سریع اضافه کن یا فرم کامل همکار را باز کن.</div>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick="closeModal();openStaffModal()">+ افزودن کامل همکار</button>
      </div>
      <div class="form-grid" style="gap:8px;margin:0">
        <div class="form-group">
          <label class="form-label">نام همکار جدید</label>
          <input class="form-input" id="sr-quick-name" placeholder="نام">
        </div>
        <div class="form-group">
          <label class="form-label">نام خانوادگی</label>
          <input class="form-input" id="sr-quick-lname" placeholder="نام خانوادگی">
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-sm" style="margin-top:8px" onclick="_quickAddStaffFromReminder()">+ افزودن سریع و انتخاب</button>
    </div>
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">همکار</label>
        <select class="form-select" id="sr-staff" onchange="_syncStaffReminderAmountFromStaff()">${staffOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="sr-title" value="پرداخت حقوق">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ مرجع (تومان)</label>
        <input class="form-input amount-input" id="sr-amount" type="number" value="${defaultAmount}">
      </div>
      <div class="form-group">
        <label class="form-label">دوره تکرار</label>
        <select class="form-select" id="sr-repeat" onchange="_syncStaffReminderRepeatCustom('sr')">${_staffReminderRepeatOptions(1)}</select>
      </div>
      <div class="form-group" id="sr-repeat-custom-wrap" style="display:none">
        <label class="form-label">تکرار هر چند ماه؟</label>
        <input class="form-input" id="sr-repeat-custom" type="number" min="0" value="1">
      </div>
    </div>
    <div class="form-section">📅 تاریخ‌های یادآوری</div>
    <div id="sr-dates"></div>
    <button type="button" class="btn btn-ghost btn-sm" onclick="_addStaffReminderDateRow()">+ افزودن تاریخ دیگر</button>
  `, [
    { label: 'ثبت یادآوری‌ها', cls: 'btn-primary', action: 'saveNewStaffReminders()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  _addStaffReminderDateRow(formatJalali(...todayJalali()));
  initDatePickers && initDatePickers();
}

async function _quickAddStaffFromReminder() {
  const name = document.getElementById('sr-quick-name')?.value.trim();
  const lname = document.getElementById('sr-quick-lname')?.value.trim() || '';
  if (!name) { showToast('نام همکار را وارد کنید', 'error'); return; }
  if (!STAFF_ROLES.length) {
    try { STAFF_ROLES = await window.api.staffRoles.getAll(); } catch(e) {}
  }
  await window.api.staff.add({
    name,
    lname,
    phone: '',
    card_number: '',
    role_id: STAFF_ROLES[0]?.id,
    roles: [],
    salary: 0,
    start_date: '',
    repeat_months: 0,
    note: 'ثبت سریع از یادآوری حقوق',
  });
  const staffList = await window.api.staff.getAll();
  window._staffReminderStaffList = staffList;
  const added = [...staffList].reverse().find(s =>
    (s.name || '') === name && ((s.lname || '') === lname)
  ) || staffList[staffList.length - 1];
  const select = document.getElementById('sr-staff');
  if (select) {
    select.innerHTML = staffList.map(s =>
      `<option value="${s.id}" ${added && s.id === added.id ? 'selected' : ''}>${escapeHtml((s.name + ' ' + (s.lname || '')).trim())} — ${fmt(s.expectedMonthly || 0)} تومان</option>`
    ).join('');
  }
  const amountInput = document.getElementById('sr-amount');
  if (amountInput && added) amountInput.value = added.expectedMonthly || 0;
  const nameInput = document.getElementById('sr-quick-name');
  const lnameInput = document.getElementById('sr-quick-lname');
  if (nameInput) nameInput.value = '';
  if (lnameInput) lnameInput.value = '';
  showToast(`${name} به همکاران اضافه و انتخاب شد ✓`, 'success');
}

async function saveNewStaffReminders() {
  const staffId = +(document.getElementById('sr-staff')?.value || 0);
  const title = document.getElementById('sr-title')?.value.trim() || 'پرداخت حقوق';
  const amount = +(document.getElementById('sr-amount')?.value || 0);
  const repeat = _readStaffReminderRepeat('sr');
  const rows = Array.from(document.querySelectorAll('#sr-dates .staff-reminder-date-row'));
  const dates = rows.map(row => readCalendarDateField('sr-date-' + row.dataset.index)).filter(Boolean);
  const uniqueDates = [...new Set(dates)];
  if (!staffId) { showToast('همکار را انتخاب کنید', 'error'); return; }
  if (!uniqueDates.length) { showToast('حداقل یک تاریخ سررسید انتخاب کنید', 'error'); return; }
  for (const date of uniqueDates) {
    await window.api.staffReminders.add({ staff_id: staffId, title, due_date: date, amount, repeat_months: repeat });
  }
  closeModal();
  showToast(`${fa(uniqueDates.length)} یادآوری ثبت شد ✓`, 'success');
  await renderStaff();
}

async function openEditStaffReminder(id) {
  const reminders = await window.api.staffReminders.getAll();
  const r = reminders.find(x => x.id === id);
  if (!r) return;
  openModal(`✏️ ویرایش یادآوری — ${escapeHtml(r.name)} ${escapeHtml(r.lname)}`, `
    <div class="form-grid">
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="esr-title" value="${escapeHtml(r.title)}">
      </div>
      <div class="form-group">
        <label class="form-label">تاریخ سررسید (شمسی)</label>
        <input class="form-input jdate" id="esr-date" value="${r.due_date_jalali}">
      </div>
      <div class="form-group">
        <label class="form-label">مبلغ (تومان)</label>
        <input class="form-input amount-input" id="esr-amount" type="number" value="${r.amount||0}">
      </div>
      <div class="form-group full">
        <label class="form-label">تکرار</label>
        <select class="form-select" id="esr-repeat" onchange="_syncStaffReminderRepeatCustom('esr')">${_staffReminderRepeatOptions(r.repeat_months ?? 1)}</select>
      </div>
      <div class="form-group full" id="esr-repeat-custom-wrap" style="display:${[0,1,2,3,6,12].includes(+(r.repeat_months ?? 1)) ? 'none' : 'block'}">
        <label class="form-label">تکرار هر چند ماه؟</label>
        <input class="form-input" id="esr-repeat-custom" type="number" min="0" value="${[0,1,2,3,6,12].includes(+(r.repeat_months ?? 1)) ? 1 : +(r.repeat_months ?? 1)}">
      </div>
    </div>
  `, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditStaffReminder(${id})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  initDatePickers();
}
async function saveEditStaffReminder(id) {
  await window.api.staffReminders.update({ id, patch: {
    title: document.getElementById('esr-title')?.value,
    due_date_jalali: document.getElementById('esr-date')?.value,
    amount: +(document.getElementById('esr-amount')?.value||0),
    repeat_months: _readStaffReminderRepeat('esr'),
    notified_levels: [],
  }});
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  await renderStaff();
}
async function deleteStaffReminder(id) {
  if (!confirm('این یادآوری حذف شود؟')) return;
  await window.api.staffReminders.delete(id);
  showToast('حذف شد', 'error');
  await renderStaff();
}


// ════════════════════════════════════════════════════════════════════════════
// INSTRUCTIONS PAGE — مرکز دانش
// ════════════════════════════════════════════════════════════════════════════
function _buildInstrTree(flat, parentId) {
  const pid = parentId ? +parentId : null;
  return (flat||[])
    .filter(function(n){ return (n.parent_id ? +n.parent_id : null) === pid; })
    .map(function(n){ 
      const children = _buildInstrTree(flat, n.id);
      return Object.assign({}, n, {items: children}); 
    });
}
let _instrPath = []; // breadcrumb path: [{id, title, icon}]
let _instrParentId = null; // current folder

/* ── Instructions page state ──────────────────────────────────────────────── */
let _instrView = 'list'; // 'gallery' | 'list' | 'compact'
let _instrViewLoaded = false;
const INSTR_VIEW_STORAGE_KEY = 'teampulse_knowledge_view';
function _instrLoadViewPreference() {
  if (_instrViewLoaded) return;
  _instrViewLoaded = true;
  const accountValue = _db && _db.preferences && _db.preferences.knowledgeView;
  let localValue = '';
  try { localValue = localStorage.getItem(INSTR_VIEW_STORAGE_KEY) || ''; } catch(e) {}
  const value = accountValue || localValue;
  _instrView = ['gallery','list','compact'].includes(value) ? value : 'list';
}
function _instrSetView(value) {
  if (!['gallery','list','compact'].includes(value)) value = 'list';
  _instrView = value;
  try { localStorage.setItem(INSTR_VIEW_STORAGE_KEY, value); } catch(e) {}
  if (_db) {
    if (!_db.preferences) _db.preferences = {};
    if (_db.preferences.knowledgeView !== value) {
      _db.preferences.knowledgeView = value;
      _save();
    }
  }
  renderInstructions();
}
let _instrFilter = 'all';   // 'all' | 'pinned' | 'folder' | 'note'
let _instrSort = 'default'; // 'default' | 'name' | 'recent' | 'oldest'
let _instrRecentIds = [];   // last 5 opened node ids

function _instrRecordOpen(id) {
  _instrRecentIds = [id, ..._instrRecentIds.filter(x => x !== id)].slice(0, 5);
}
function _instrAccent(item) {
  const strong = item?.pinned || item?.importance === 'key';
  return strong ? (item.color || '#7c6af7') : 'rgba(148,163,184,.28)';
}
const INSTR_DEFAULT_CATEGORIES = [
  { key:'personal', icon:'🏠', title:'شخصی', folders:['قوانین زندگی','اهداف و برنامه‌ها','سلامت','ارتباطات'] },
  { key:'projects', icon:'🚀', title:'پروژه‌ها', folders:[] },
  { key:'staff', icon:'👥', title:'همکاران', folders:[] },
  { key:'business', icon:'💼', title:'کسب‌وکار', folders:[] },
  { key:'education', icon:'📚', title:'آموزش', folders:[] },
  { key:'public', icon:'🌍', title:'عمومی', folders:[] },
];
function _instrNextLocalId() {
  if (!_db._nextId) _db._nextId = {};
  if (!_db._nextId.instructions) {
    _db._nextId.instructions = ((_db.instructions||[]).reduce((m,n)=>Math.max(m,+n.id||0),0) || 0) + 1;
  }
  return _db._nextId.instructions++;
}
function _instrEnsureKnowledgeStructure() {
  if (!_db.instructions) _db.instructions = [];
  const items = _db.instructions;
  function removeEmptyDefaultStudentsCategory() {
    const idx = items.findIndex(n => n.type === 'kcategory' && (n.kcat_key === 'students' || n.title === 'شاگردان'));
    if (idx < 0) return false;
    const cat = items[idx];
    const hasChildren = items.some(n => n.parent_id && +n.parent_id === +cat.id);
    if (hasChildren) return false;
    items.splice(idx, 1);
    return true;
  }
  if (_db._knowledgeSchemaVersion >= 3) return;
  if (_db._knowledgeSchemaVersion >= 2) {
    removeEmptyDefaultStudentsCategory();
    _db._knowledgeSchemaVersion = 3;
    _save();
    return;
  }
  const hadUserItems = items.length > 0;
  const catByKey = {};
  INSTR_DEFAULT_CATEGORIES.forEach((cat, idx) => {
    let node = items.find(n => n.type === 'kcategory' && n.kcat_key === cat.key);
    if (!node) {
      node = {
        id:_instrNextLocalId(), parent_id:null, type:'kcategory',
        kcat_key:cat.key, title:cat.title, icon:cat.icon, color:'#7c6af7',
        content:'', extra_note:'', importance:'normal', status:'active',
        tags:[], stickers:[], attachments:[],
        created_at:new Date(Date.now() + idx).toISOString(),
        updated_at:new Date().toISOString(),
      };
      items.push(node);
    }
    catByKey[cat.key] = node;
  });
  const publicCat = catByKey.public;
  let publicNotesFolder = null;
  const roots = items.filter(n => !n.parent_id && n.type !== 'kcategory');
  roots.forEach(n => {
    if (n.type === 'category') {
      n.parent_id = publicCat.id;
    } else {
      if (!publicNotesFolder) {
        publicNotesFolder = items.find(x => x.type === 'category' && +x.parent_id === +publicCat.id && x.title === 'یادداشت‌های عمومی');
        if (!publicNotesFolder) {
          publicNotesFolder = {
            id:_instrNextLocalId(), parent_id:publicCat.id, type:'category',
            title:'یادداشت‌های عمومی', icon:'📝', color:'#64748b',
            content:'', extra_note:'', importance:'normal', status:'active',
            tags:[], stickers:[], attachments:[],
            created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
          };
          items.push(publicNotesFolder);
        }
      }
      n.parent_id = publicNotesFolder.id;
    }
  });
  if (!hadUserItems) {
    INSTR_DEFAULT_CATEGORIES.forEach(cat => {
      const parent = catByKey[cat.key];
      cat.folders.forEach((title, i) => {
        const exists = items.some(n => n.type === 'category' && +n.parent_id === +parent.id && n.title === title);
        if (!exists) {
          items.push({
            id:_instrNextLocalId(), parent_id:parent.id, type:'category',
            title, icon:'📁', color:'#64748b',
            content:'', extra_note:'', importance:'normal', status:'active',
            tags:[], stickers:[], attachments:[],
            created_at:new Date(Date.now() + i).toISOString(), updated_at:new Date().toISOString(),
          });
        }
      });
    });
  }
  items.forEach(n => {
    if (!Array.isArray(n.tags)) n.tags = [];
    if (!n.status) n.status = 'active';
  });
  removeEmptyDefaultStudentsCategory();
  _db._knowledgeSchemaVersion = 3;
  _save();
}
function _instrCurrentNode() {
  return _instrParentId ? (_db.instructions||[]).find(n => +n.id === +_instrParentId) : null;
}
function _instrCurrentLevel() {
  const node = _instrCurrentNode();
  if (!node) return 'root';
  if (node.type === 'kcategory') return 'category';
  return 'folder';
}
/* CSP binder (tp-inline-bind) only accepts literals in onclick — not live
   identifiers like `_instrParentId`. Bake the current folder id at render time. */
function _instrParentLiteral() {
  return (_instrParentId == null || _instrParentId === '') ? 'null' : String(+_instrParentId);
}
function _parseTags(value) {
  return String(value||'').split(/[،,\n#]+/).map(t => t.trim()).filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i);
}
function _instrTagsHtml(tags, dense) {
  tags = Array.isArray(tags) ? tags : [];
  if (!tags.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:${dense?'3':'5'}px;margin-top:${dense?'4':'8'}px">
    ${tags.slice(0, dense ? 3 : 8).map(t => `<span style="font-size:${dense?'9':'10'}px;padding:${dense?'1px 5px':'2px 7px'};border-radius:999px;background:rgba(124,106,247,.13);color:var(--accent2);font-weight:700">#${escapeHtml(t)}</span>`).join('')}
  </div>`;
}
function _instrTypeMeta(item) {
  if (item?.type === 'kcategory') return { cls:'kcategory', icon:'🗂', label:'دسته‌بندی' };
  if (item?.type === 'category') return { cls:'category', icon:'📁', label:'پوشه' };
  return { cls:'note', icon:'📝', label:'یادداشت' };
}
function _instrTypeBadge(item) {
  const m = _instrTypeMeta(item);
  return `<span class="_instr-type-badge _instr-type-${m.cls}" title="${escapeHtml(m.label)}">${escapeHtml(m.icon)} ${escapeHtml(m.label)}</span>`;
}

/* ─────────────────────────────────────────────────────────────────────────── */
async function renderInstructions(instrSearch) {
  document.body.classList.add('knowledge-page');
  instrSearch = instrSearch || '';
  try {
  updateTopbarActions(`
    <div class="table-search" style="margin-left:8px">
      <span style="color:var(--text3)">🔍</span>
      <input id="instr-search-input" placeholder="جستجو در دسته‌بندی، پوشه، یادداشت و برچسب... (کنترل + K)" oninput="renderInstructions(this.value)" value="${escapeHtml(instrSearch)}">
    </div>
  `);

  if (!_db) {
    void _loadPrimaryDatabase().then(() => renderInstructions(instrSearch));
    return;
  }
  if (!_db) { _db = _freshData(); }
  if (!_db.instructions) { _db.instructions = []; }
  _instrEnsureKnowledgeStructure();
  _instrLoadViewPreference();

  const rawFlat = (_db.instructions || []).filter(n => !n.staff_id);
  if (_instrParentId && !_teamCanInstructionNode(_instrParentId)) {
    updateTopbarActions('');
    setContent(_teamAccessDeniedHtml('instructions'));
    return;
  }
  const flat = rawFlat.filter(n => _teamCanInstructionNode(n.id));

  /* ── Stats bar removed: folder/note/pin counters had no effect on what the user
     was trying to do (find & open something) — pure visual noise on every load. ── */
  const statsBar = '';

  /* ── Breadcrumb (only shown once inside a folder — at the root it's just noise) ──
     Two variants rendered together, toggled by CSS (same pattern stats used to use):
     full clickable trail on desktop, compact "home / parent / current" pill on mobile —
     so the path is never simply hidden, it's just adapted to the screen. ── */
  let breadcrumb = '';
  if (_instrPath.length) {
    const backTargetPath = _instrPath.slice(0, -1);
    const backTarget = backTargetPath.length ? backTargetPath[backTargetPath.length - 1] : null;
    const crumbButton = (label, parentId, path, className, extraStyle) => {
      const encodedPath = encodeURIComponent(JSON.stringify(path || [])).replace(/'/g, '%27');
      const parentValue = parentId == null ? '' : String(+parentId);
      return `<button type="button" class="${className}" data-instr-parent="${parentValue}" data-instr-path="${encodedPath}" onclick="_instrCrumbGo(this)"${extraStyle ? ` style="${extraStyle}"` : ''}>${label}</button>`;
    };
    let full = `<div class="instr-breadcrumb instr-breadcrumb-full">
      ${crumbButton('‹ عقب', backTarget ? backTarget.id : null, backTargetPath, 'instr-crumb-back')}
      ${crumbButton('🏠 مرکز دانش', null, [], 'instr-crumb-link')}`;
    _instrPath.forEach((p, i) => {
      const isCurrent = i === _instrPath.length - 1;
      full += `<span class="instr-crumb-sep">‹</span>
        ${crumbButton(`${escapeHtml(p.icon||'📁')} ${escapeHtml(p.title)}`, p.id, _instrPath.slice(0,i+1), `instr-crumb-link ${isCurrent ? 'instr-crumb-current' : ''}`)}`;
    });
    full += `</div>`;

    const parent = _instrPath.length > 1 ? _instrPath[_instrPath.length-2] : null;
    /* روی موبایل جای کم است و عنوان پوشه‌ی فعلی همین حالا توی هدر (کنار دکمه‌ی بازگشت) دیده می‌شه،
       پس این‌جا فقط «خانه ‹ بالادست» به‌صورت کوتاه نشون داده می‌شه — نه کل مسیر که باعث بریدگی می‌شد */
    const compact = `<div class="instr-breadcrumb instr-breadcrumb-compact" style="max-width:100%;min-width:0">
      ${crumbButton('‹ عقب', backTarget ? backTarget.id : null, backTargetPath, 'instr-crumb-back')}
      ${crumbButton('🏠', null, [], 'instr-crumb-link', 'flex-shrink:0')}
      ${parent ? `<span class="instr-crumb-sep">‹</span>${crumbButton(escapeHtml(parent.title), parent.id, _instrPath.slice(0,_instrPath.length-1), 'instr-crumb-link', 'max-width:30vw')}` : ''}
      <span class="instr-crumb-sep">‹</span><span class="instr-crumb-link instr-crumb-current" style="max-width:36vw">${escapeHtml(_instrPath[_instrPath.length-1].title)}</span>
    </div>`;

    breadcrumb = full + compact;
  }
  _instrSetHeaderNav(_instrPath.length > 0, _instrPath.length ? `${escapeHtml(_instrPath[_instrPath.length-1].icon||'📁')} ${_instrPath[_instrPath.length-1].title}` : null);

  /* ── Windows/desktop toolbar: centralizes every create/sort/search action that used
     to be split between the topbar and per-folder buttons. Hidden on mobile — the FAB
     already covers create actions there, and there's no room for a toolbar row too. ── */
  const toolbar = _instrToolbarHtml();

  /* ── Get items for current folder ── */
  let items = flat.filter(n => (n.parent_id||null) === (_instrParentId ? +_instrParentId : null));
  const currentLevel = _instrCurrentLevel();
  if (!instrSearch) {
    if (currentLevel === 'root') items = items.filter(n => n.type === 'kcategory');
    else if (currentLevel === 'category') items = items.filter(n => n.type !== 'kcategory');
    else items = items.filter(n => n.type !== 'kcategory');
  }

  /* ── Search: full-text across ALL items ── */
  if (instrSearch) {
    const q = instrSearch.toLowerCase();
    function _getAllDesc(pid) {
      const res = [];
      flat.filter(function(n){ return (n.parent_id||null)===(pid?+pid:null); }).forEach(function(c){
        res.push(c);
        if (c.type==='category' || c.type==='kcategory') res.push.apply(res, _getAllDesc(c.id));
      });
      return res;
    }
    const scope = _instrParentId ? _getAllDesc(_instrParentId) : flat;
    items = scope.filter(function(n){
      return n.title.toLowerCase().includes(q) ||
        (n.content||'').toLowerCase().includes(q) ||
        (n.extra_note||'').toLowerCase().includes(q) ||
        (Array.isArray(n.tags) && n.tags.some(t => String(t).toLowerCase().includes(q)));
    });
  }

  /* ── Filter ── */
  if (!instrSearch) {
    if (_instrFilter === 'pinned') items = items.filter(x => x.pinned);
    else if (_instrFilter === 'folder') items = items.filter(x => x.type === 'category' || x.type === 'kcategory');
    else if (_instrFilter === 'note') items = items.filter(x => x.type !== 'category' && x.type !== 'kcategory');
  }

  /* ── Pinned section (root only) ── */
  let pinnedBar = '';
  if (false && !_instrParentId && !instrSearch && _instrFilter === 'all') {
    const pinned = flat.filter(x => x.pinned);
    if (pinned.length) {
      pinnedBar = `<div class="instr-pinned-section" style="margin-bottom:20px">
        ${pinned.length > 1 ? `<div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em;margin-bottom:8px;text-transform:uppercase">📌 پین‌شده‌ها</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap">`;
      pinned.forEach(item => {
        const c = item.color || '#7c6af7';
        pinnedBar += `<div onclick="${(item.type==='category'||item.type==='kcategory')?`_instrOpenFolder(${item.id},'${(item.icon||'📁').replace(/'/g,"\\'")}','${item.title.replace(/'/g,"\\'")}')`:``}${(item.type!=='category'&&item.type!=='kcategory')?`openNoteDetail(${item.id})`:''}; _instrRecordOpen(${item.id})"
          style="display:flex;align-items:center;gap:7px;padding:7px 12px;background:var(--bg2);border:1px solid var(--border);border-right:3px solid ${c};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text);transition:all .15s"
          onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='var(--bg2)'">
          <span>${escapeHtml(item.icon||'📁')}</span><span>${escapeHtml(item.title)}</span>
        </div>`;
      });
      pinnedBar += `</div></div>`;
    }
  }

  /* ── Recent section (root only) ── */
  let recentBar = '';
  if (!_instrParentId && !instrSearch && _instrFilter === 'all' && _instrRecentIds.length) {
    const recentNodes = _instrRecentIds.map(id => flat.find(x => x.id === id)).filter(Boolean);
    if (recentNodes.length) {
      recentBar = `<div class="instr-recent-section" style="margin-bottom:20px;padding:14px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text2);letter-spacing:.06em;margin-bottom:10px;text-transform:uppercase">🕓 ادامه آخرین کار</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">`;
      recentNodes.forEach(item => {
        const c = item.color || '#7c6af7';
        recentBar += `<div onclick="${(item.type==='category'||item.type==='kcategory')?`_instrOpenFolder(${item.id},'${(item.icon||'📁').replace(/'/g,"\\'")}','${item.title.replace(/'/g,"\\'")}')`:``}${(item.type!=='category'&&item.type!=='kcategory')?`openNoteDetail(${item.id})`:''}; _instrRecordOpen(${item.id})"
          style="display:flex;align-items:center;gap:7px;padding:7px 14px;background:var(--bg3);border:1px solid var(--border2);border-right:3px solid ${c};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;color:var(--text);transition:all .15s"
          onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background='var(--bg3)'">
          <span>${escapeHtml(item.icon||'📝')}</span><span>${escapeHtml(item.title)}</span>
        </div>`;
      });
      recentBar += `</div></div>`;
    }
  }

  /* ── Empty state ── */
  if (items.length === 0) {
    const canCreateHere = _teamCanCreateInstruction(_instrParentId);
    const emptyIcon = instrSearch ? '🔍' : (currentLevel === 'root' ? '🗂' : '📁');
    const emptyHint = currentLevel === 'root'
      ? 'برای شروع، دانش‌ها را در دسته‌بندی‌های اصلی مرتب کن.'
      : 'اینجا می‌توانی زیرپوشه بسازی یا مستقیم یادداشت اضافه کنی.';
    const emptyCreate = currentLevel === 'root'
      ? `<button class="btn btn-primary" onclick="openAddInstruction(null,'kcategory')">🗂 دسته‌بندی جدید</button>`
      : `<button class="btn btn-primary" onclick="openAddInstruction(${_instrParentLiteral()},'category')">📁 پوشه جدید</button>
         <button class="btn btn-ghost" onclick="openAddInstruction(${_instrParentLiteral()},'note')">📝 یادداشت جدید</button>`;
    setContent(statsBar + breadcrumb + toolbar + pinnedBar + recentBar + `
      <div class="empty" style="padding:48px 24px">
        <span style="font-size:52px">${emptyIcon}</span>
        <p style="font-size:15px;font-weight:700;margin:12px 0 6px">${instrSearch ? 'چیزی پیدا نشد' : 'هنوز چیزی اضافه نشده'}</p>
        ${!instrSearch && canCreateHere ? `
          <p style="font-size:12px;color:var(--text3);line-height:1.8;max-width:300px;margin:0 auto 16px">
            ${emptyHint}
          </p>
          <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            ${emptyCreate}
          </div>` : ''}
      </div>` + _instrFabHtml());
    return;
  }

  /* ── Separate folders / notes ── */
  const folders = items.filter(x => x.type === 'category' || x.type === 'kcategory');
  const notes   = items.filter(x => x.type !== 'category' && x.type !== 'kcategory');

  /* ── Sort: pinned always float first; within each group, order depends on _instrSort ── */
  const sortItems = arr => {
    const byMode = (a, b) => {
      if (_instrSort === 'name') return a.title.localeCompare(b.title, 'fa');
      if (_instrSort === 'recent') return new Date(b.updated_at||0) - new Date(a.updated_at||0);
      if (_instrSort === 'oldest') return new Date(a.updated_at||0) - new Date(b.updated_at||0);
      return 0; // 'default' — keep original/creation order
    };
    return [...arr].sort(byMode);
  };

  let html = statsBar + breadcrumb + toolbar + pinnedBar + recentBar;

  /* ── FOLDERS ── */
  if (folders.length > 0) {
    const folderTitle = currentLevel === 'root' && !instrSearch ? 'دسته‌بندی‌ها' : 'پوشه‌ها';
    html += `<div class="instr-folders-section" style="margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em;margin-bottom:10px">${currentLevel === 'root' && !instrSearch ? '🗂' : '📁'} ${folderTitle} (${fa(folders.length)})</div>`;

    if (_instrView === 'gallery') {
      /* ── GALLERY: tall cards, big icon, preview of 3 notes, color bar ── */
      html += `<div class="_ifgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:14px">`;
      sortItems(folders).forEach(item => {
        const childCount = flat.filter(x => x.parent_id && +x.parent_id === +item.id).length;
        const countLabel = item.type === 'kcategory' ? 'پوشه' : 'آیتم';
        const color = _instrAccent(item);
        const lastEdit = item.updated_at ? _relTime(item.updated_at) : '';
        const subfolders = flat.filter(x => x.parent_id && +x.parent_id === +item.id && (x.type === 'category' || x.type === 'kcategory'));
        const visibleSubfolders = subfolders.slice(0, 6);
        const subfoldersHtml = visibleSubfolders.length ? `
          <div class="_ifcard-subfolders" title="${escapeHtml(subfolders.map(x => x.title).join('، '))}">
            ${visibleSubfolders.map(f => `<span class="_ifcard-subfolder-chip"><span>📁 ${escapeHtml(f.title)}</span></span>`).join('')}
            ${subfolders.length > visibleSubfolders.length ? `<span class="_ifcard-subfolder-chip"><span>+${fa(subfolders.length - visibleSubfolders.length)}</span></span>` : ''}
          </div>` : '';
        const preview = flat.filter(x => x.parent_id && +x.parent_id === +item.id && x.type !== 'category' && x.type !== 'kcategory').slice(0,3);
        const previewHtml = preview.length ? `
          <div class="_ifcard-preview" style="border-top:1px solid var(--border);padding:8px 14px 10px;display:flex;flex-direction:column;gap:4px">
            ${preview.map(n=>`<div style="font-size:11.5px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">✓ ${escapeHtml(n.title)}</div>`).join('')}
          </div>` : '';

        const iconSafe = (item.icon||'📁').replace(/'/g,"\\'");
        const titleSafe = item.title.replace(/'/g,"\\'");

        html += `
          <div class="_ifcard _ifcard-gallery" data-id="${item.id}" data-type="folder"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden;cursor:pointer;transition:all .2s;position:relative;display:flex;flex-direction:column"
            onclick="_instrOpenFolder(${item.id},'${iconSafe}','${titleSafe}');_instrRecordOpen(${item.id})"
            onmouseover="_instrHoverCard(this,'${color}')"
            onmouseout="_instrUnhoverCard(this)">
            <div style="height:3px;background:${color}"></div>
            <div class="_ifcard-body" style="padding:13px 14px 11px">
              ${item.pinned ? `<span style="position:absolute;top:10px;left:10px;font-size:12px" title="پین شده">📌</span>` : ''}
              <div class="_ifcard-icon" style="font-size:28px;margin-bottom:7px">${escapeHtml(item.icon||'📁')}</div>
              <div class="_ifcard-title-row" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0">
                <div class="_ifcard-title" style="font-weight:700;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1">${escapeHtml(item.title)}</div>
                ${_instrTypeBadge(item)}
              </div>
              <div class="_ifcard-divider" style="height:1px;background:var(--border);margin-bottom:6px"></div>
              <span style="font-size:11px;color:var(--text3)">${fa(childCount)} ${countLabel}</span>
              ${lastEdit ? `<div style="font-size:10px;color:var(--text3);margin-top:4px">✏️ ${lastEdit}</div>` : ''}
              ${subfoldersHtml}
            </div>
            ${previewHtml}
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" style="position:absolute;top:8px;left:8px" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="position:absolute;top:8px;left:8px;display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11px" title="ویرایش">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:11px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:11px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:11px" title="${item.pinned?'حذف پین':'پین کردن'}">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:11px" title="حذف">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;

    } else if (_instrView === 'list') {
      /* ── LIST: horizontal rows — icon | title + item count | last edit | actions ── */
      html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden">`;
      sortItems(folders).forEach((item, idx, arr) => {
        const childCount = flat.filter(x => x.parent_id && +x.parent_id === +item.id).length;
        const countLabel = item.type === 'kcategory' ? 'پوشه' : 'آیتم';
        const color = _instrAccent(item);
        const lastEdit = item.updated_at ? _relTime(item.updated_at) : '';
        const isLast = idx === arr.length - 1;
        const iconSafe = (item.icon||'📁').replace(/'/g,"\\'");
        const titleSafe = item.title.replace(/'/g,"\\'");
        html += `
          <div class="_ifcard _ifcard-list-row" data-id="${item.id}" data-type="folder"
            style="display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 14px;cursor:pointer;transition:background .15s;position:relative;border-right:3px solid ${color};${!isLast?'border-bottom:1px solid var(--border)':''}"
            onclick="_instrOpenFolder(${item.id},'${iconSafe}','${titleSafe}');_instrRecordOpen(${item.id})"
            onmouseover="this.style.background='var(--bg3)'"
            onmouseout="this.style.background=''">
            <span style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${escapeHtml(item.icon||'📁')}</span>
            <div style="flex:1;min-width:0">
              <div class="_ifcard-title-row" style="display:flex;align-items:center;gap:8px">
                <span class="_ifcard-title" style="font-weight:600;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${escapeHtml(item.title)}</span>
                ${_instrTypeBadge(item)}
                ${item.pinned ? `<span style="font-size:11px;flex-shrink:0">📌</span>` : ''}
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:1px">${fa(childCount)} ${countLabel}</div>
            </div>
            ${lastEdit ? `<div style="font-size:10px;color:var(--text3);flex-shrink:0;white-space:nowrap">${lastEdit}</div>` : ''}
            <span style="color:var(--text3);flex-shrink:0;font-size:14px">‹</span>
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none;flex-shrink:0">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11px" title="ویرایش">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:11px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:11px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:11px" title="${item.pinned?'حذف پین':'پین'}">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:11px" title="حذف">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;

    } else {
      /* ── COMPACT: pure density — icon + title + count only, no preview ── */
      html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden">`;
      sortItems(folders).forEach((item, idx, arr) => {
        const childCount = flat.filter(x => x.parent_id && +x.parent_id === +item.id).length;
        const countLabel = item.type === 'kcategory' ? 'پوشه' : 'آیتم';
        const color = _instrAccent(item);
        const isLast = idx === arr.length - 1;
        const iconSafe = (item.icon||'📁').replace(/'/g,"\\'");
        const titleSafe = item.title.replace(/'/g,"\\'");
        html += `
          <div class="_ifcard" data-id="${item.id}" data-type="folder"
            style="display:flex;align-items:center;gap:9px;min-height:36px;padding:6px 12px;cursor:pointer;transition:background .12s;position:relative;border-right:2px solid ${color};${!isLast?'border-bottom:1px solid var(--border)':''}"
            onclick="_instrOpenFolder(${item.id},'${iconSafe}','${titleSafe}');_instrRecordOpen(${item.id})"
            onmouseover="this.style.background='var(--bg3)'"
            onmouseout="this.style.background=''">
            <span style="font-size:15px;width:20px;text-align:center;flex-shrink:0">${escapeHtml(item.icon||'📁')}</span>
            <span class="_ifcard-title" style="font-size:12px;font-weight:500;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</span>
            ${_instrTypeBadge(item)}
            ${item.pinned ? `<span style="font-size:11px;flex-shrink:0">📌</span>` : ''}
            <span style="font-size:10px;color:var(--text3);flex-shrink:0">${fa(childCount)} ${countLabel}</span>
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none;flex-shrink:0">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:10px">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:10px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:10px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:10px">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:10px">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;
    }

    html += `</div>`;
  }

  /* ── NOTES ── */
  if (notes.length > 0) {
    html += `<div>
      <div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.06em;margin-bottom:10px;text-transform:uppercase">📝 یادداشت‌ها (${fa(notes.length)})</div>`;

    if (_instrView === 'gallery') {
      /* ── GALLERY: tall cards, big icon, full excerpt, color top bar ── */
      html += `<div class="_ifgrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">`;
      sortItems(notes).forEach(item => {
        const color = _instrAccent(item);
        const isKey = item.importance === 'key';
        const excerptText = (item.content||'').replace(/\*\*|==|`/g,'').slice(0,90);
        const lastEdit = item.updated_at ? _relTime(item.updated_at) : '';
        html += `
          <div class="_ifcard _ifcard-gallery" data-id="${item.id}" data-type="note"
            style="background:var(--bg2);border:1px solid ${isKey?'var(--amber)':'var(--border)'};border-top:3px solid ${color};border-radius:14px;padding:14px 14px 12px;cursor:pointer;transition:all .2s;position:relative;min-height:112px;display:flex;flex-direction:column"
            onclick="openNoteDetail(${item.id});_instrRecordOpen(${item.id})"
            onmouseover="_instrHoverCard(this,'${color}')"
            onmouseout="_instrUnhoverCard(this)">
            ${item.pinned ? `<span style="position:absolute;top:10px;left:10px;font-size:12px">📌</span>` : ''}
            <div class="_ifcard-icon" style="font-size:25px;margin-bottom:7px">${escapeHtml(item.icon||'📝')}</div>
            <div class="_ifcard-title-row" style="display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0">
              <div class="_ifcard-title" style="font-weight:700;font-size:14px;color:var(--text);line-height:1.4;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</div>
              ${_instrTypeBadge(item)}
            </div>
            ${isKey ? `<span style="display:inline-block;font-size:10px;background:rgba(251,191,36,.15);color:var(--amber);border-radius:5px;padding:2px 7px;font-weight:600;margin-bottom:8px">⭐ مهم</span>` : ''}
            ${_instrTagsHtml(item.tags||[], true)}
            ${excerptText ? `<div class="_ifcard-preview" style="font-size:12px;color:var(--text2);line-height:1.65;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical">${escapeHtml(excerptText)}${(item.content||'').length>90?'…':''}</div>` : '<div style="flex:1"></div>'}
            ${lastEdit ? `<div style="font-size:10px;color:var(--text3);margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">✏️ ${lastEdit}</div>` : ''}
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" style="position:absolute;top:8px;left:8px" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="position:absolute;top:8px;left:8px;display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11px" title="ویرایش">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:11px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:11px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:11px" title="${item.pinned?'حذف پین':'پین'}">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:11px" title="حذف">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;

    } else if (_instrView === 'list') {
      /* ── LIST: horizontal rows — icon | title + excerpt | meta | actions ── */
      html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden">`;
      sortItems(notes).forEach((item, idx, arr) => {
        const color = _instrAccent(item);
        const isKey = item.importance === 'key';
        const excerptText = (item.content||'').replace(/\*\*|==|`/g,'').slice(0,80);
        const lastEdit = item.updated_at ? _relTime(item.updated_at) : '';
        const isLast = idx === arr.length - 1;
        html += `
          <div class="_ifcard _ifcard-list-row" data-id="${item.id}" data-type="note"
            style="display:flex;align-items:center;gap:12px;min-height:46px;padding:8px 14px;cursor:pointer;transition:all .15s;position:relative;border-right:3px solid ${color};${!isLast?'border-bottom:1px solid var(--border)':''}"
            onclick="openNoteDetail(${item.id});_instrRecordOpen(${item.id})"
            onmouseover="this.style.background='var(--bg3)'"
            onmouseout="this.style.background=''">
            <span style="font-size:20px;flex-shrink:0;width:28px;text-align:center">${escapeHtml(item.icon||'📝')}</span>
            <div style="flex:1;min-width:0">
              <div class="_ifcard-title-row" style="display:flex;align-items:center;gap:8px">
                <span class="_ifcard-title" style="font-weight:600;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${escapeHtml(item.title)}</span>
                ${_instrTypeBadge(item)}
                ${isKey ? `<span style="font-size:10px;background:rgba(251,191,36,.15);color:var(--amber);border-radius:4px;padding:1px 6px;font-weight:600;flex-shrink:0">⭐ مهم</span>` : ''}
                ${item.pinned ? `<span style="font-size:11px;flex-shrink:0">📌</span>` : ''}
              </div>
              ${excerptText ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(excerptText)}${(item.content||'').length>80?'…':''}</div>` : ''}
              ${_instrTagsHtml(item.tags||[], true)}
            </div>
            ${lastEdit ? `<div style="font-size:10px;color:var(--text3);flex-shrink:0;white-space:nowrap">${lastEdit}</div>` : ''}
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none;flex-shrink:0">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:11px" title="ویرایش">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:11px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:11px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:11px" title="${item.pinned?'حذف پین':'پین'}">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:26px;height:26px;border-radius:7px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:11px" title="حذف">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;

    } else {
      /* ── COMPACT: pure density — just icon + title, no excerpt, no meta ── */
      html += `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;overflow:hidden">`;
      sortItems(notes).forEach((item, idx, arr) => {
        const color = _instrAccent(item);
        const isKey = item.importance === 'key';
        const isLast = idx === arr.length - 1;
        html += `
          <div class="_ifcard" data-id="${item.id}" data-type="note"
            style="display:flex;align-items:center;gap:9px;min-height:36px;padding:6px 12px;cursor:pointer;transition:background .12s;position:relative;border-right:2px solid ${color};${!isLast?'border-bottom:1px solid var(--border)':''}"
            onclick="openNoteDetail(${item.id});_instrRecordOpen(${item.id})"
            onmouseover="this.style.background='var(--bg3)'"
            onmouseout="this.style.background=''">
            <span style="font-size:15px;width:20px;text-align:center;flex-shrink:0">${escapeHtml(item.icon||'📝')}</span>
            <span class="_ifcard-title" style="font-size:12px;font-weight:500;color:var(--text);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.title)}</span>
            ${_instrTypeBadge(item)}
            ${isKey ? `<span style="font-size:10px;color:var(--amber);flex-shrink:0">⭐</span>` : ''}
            ${item.pinned ? `<span style="font-size:11px;flex-shrink:0">📌</span>` : ''}
            <button type="button" class="_ifcard-more-btn" onclick="_ifToggleActions(this)" title="بیشتر">⋮</button>
            <div class="_ifcard-actions" style="display:flex;gap:3px;opacity:0;transition:opacity .15s;pointer-events:none;flex-shrink:0">
              <button onclick="event.stopPropagation();openEditInstruction(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--text2);cursor:pointer;font-size:10px">✏️</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'move')" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--purple);cursor:pointer;font-size:10px" title="انتقال">📁</button>
              <button onclick="event.stopPropagation();_instrOpenTransferModal([${item.id}],'copy')" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--green);cursor:pointer;font-size:10px" title="کپی">📋</button>
              <button onclick="event.stopPropagation();_instrTogglePin(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--amber);cursor:pointer;font-size:10px">${item.pinned?'📌':'📍'}</button>
              <button onclick="event.stopPropagation();deleteInstruction(${item.id})" style="width:22px;height:22px;border-radius:6px;border:1px solid var(--border2);background:var(--bg3);color:var(--red);cursor:pointer;font-size:10px">🗑</button>
            </div>
          </div>`;
      });
      html += `</div>`;
    }
    html += `</div>`;
  }

  /* ── Floating action button (mobile create shortcut) ── */
  html += _instrFabHtml();

  setContent(html);

  if (instrSearch) {
    requestAnimationFrame(() => {
      const si = document.querySelector('#topbar-actions .table-search input');
      if (si) { si.focus(); try { si.setSelectionRange(instrSearch.length, instrSearch.length); } catch(e){} }
    });
  }
  } catch(e) {
    console.error('[TeamPulse] renderInstructions error:', e);
    setContent('<div style="text-align:center;padding:40px;color:var(--red)">'
      + '<div style="font-size:32px">⚠️</div>'
      + '<div style="font-weight:700;margin:8px 0">خطا در بارگذاری</div>'
      + '<div style="font-size:11px;color:var(--text3);margin-bottom:12px">' + escapeHtml(e.message||'') + '</div>'
      + '<button class="btn btn-primary" onclick="renderInstructions()">🔄 تلاش مجدد</button>'
      + '</div>');
  }
}

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function _filterBtn(key, label) {
  const active = _instrFilter === key;
  return `<button onclick="_instrFilter='${key}';renderInstructions()"
    style="padding:5px 13px;border-radius:20px;border:1px solid ${active?'var(--accent)':'var(--border)'};
    background:${active?'rgba(124,106,247,.15)':'var(--bg2)'};color:${active?'var(--accent2)':'var(--text2)'};
    font-size:11px;font-weight:${active?700:400};cursor:pointer;font-family:var(--font);transition:all .15s">${label}</button>`;
}

function _viewBtn(key, label) {
  const active = _instrView === key;
  return `<button onclick="_instrSetView('${key}')"
    style="padding:5px 11px;border-radius:8px;border:1px solid ${active?'var(--accent)':'var(--border)'};
    background:${active?'rgba(124,106,247,.15)':'var(--bg2)'};color:${active?'var(--accent2)':'var(--text2)'};
    font-size:11px;font-weight:${active?700:400};cursor:pointer;font-family:var(--font);transition:all .15s">${label}</button>`;
}

/* ── تولبار اختصاصی ویندوز/دسکتاپ ── جایگزین دکمه‌های پراکنده‌ی قبلی و ردیف فیلتر
   جداگانه؛ ساخت، فیلتر و مرتب‌سازی همه در یک ردیف — همان الگویی که کاربران از
   File Explorer، Notion و Google Drive می‌شناسند. (فقط دسکتاپ؛ در موبایل ردیف
   فیلتر قدیمی زیر نوار نمایش/فیلتر همچنان جدا نمایش داده می‌شود.) ── */
function _instrToolbarHtml() {
  const level = _instrCurrentLevel();
  const canCreate = _teamCanCreateInstruction(_instrParentId);
  const createButtons = !canCreate ? '' : level === 'root' ? `
      <button class="btn btn-primary instr-toolbar-create-btn" onclick="openAddInstruction(null,'kcategory')" style="font-size:12px">
        <span class="btn-icon">🗂</span><span> دسته‌بندی جدید</span>
      </button>` : `
      <button class="btn btn-primary instr-toolbar-create-btn" onclick="openAddInstruction(${_instrParentLiteral()},'category')" style="font-size:12px">
        <span class="btn-icon">📁</span><span> پوشه جدید</span>
      </button>
      <button class="btn btn-ghost instr-toolbar-create-btn" onclick="openAddInstruction(${_instrParentLiteral()},'note')" style="font-size:12px">
        <span class="btn-icon">📝</span><span> یادداشت جدید</span>
      </button>`;
  return `
    <div class="instr-toolbar" style="align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding:6px;background:var(--bg2);border:1px solid var(--border);border-radius:10px">
      ${createButtons}
      ${createButtons ? `<div class="instr-toolbar-divider" style="width:1px;align-self:stretch;background:var(--border);margin:0 2px"></div>` : ''}
      <div class="instr-toolbar-segment">
        <span class="instr-control-label">فیلتر</span>
        ${_filterBtn('all','همه')}
        ${_filterBtn('pinned','📌 پین‌شده‌ها')}
      </div>
      <div class="instr-toolbar-divider" style="width:1px;align-self:stretch;background:var(--border);margin:0 2px"></div>
      <label id="instr-view-group" class="instr-view-select" title="انتخاب حالت نمایش مرکز دانش">
        <span>نمایش</span>
        <select onchange="_instrSetView(this.value)" aria-label="نمایش مرکز دانش">
          <option value="gallery" ${_instrView==='gallery'?'selected':''}>گالری</option>
          <option value="list" ${_instrView==='list'?'selected':''}>فهرست</option>
          <option value="compact" ${_instrView==='compact'?'selected':''}>فشرده</option>
        </select>
      </label>
    </div>`;
}
function _instrCycleSort() {
  _instrSort = _instrSort === 'default' ? 'name' : _instrSort === 'name' ? 'recent' : _instrSort === 'recent' ? 'oldest' : 'default';
  renderInstructions();
}
function _instrFocusSearch() {
  const el = document.getElementById('instr-search-input');
  if (el) el.focus();
}
/* Ctrl/Cmd+K still jumps to the search field that already lives in the topbar —
   no separate search button needed in the toolbar itself. */
if (!window._instrQuickSearchBound) {
  window._instrQuickSearchBound = true;
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && typeof currentPage !== 'undefined' && currentPage === 'instructions') {
      e.preventDefault();
      _instrFocusSearch();
    }
  });
}

/* ── دکمه شناور (FAB) ایجاد یادداشت/پوشه — فقط موبایل ── */
function _instrFabHtml() {
  if (!_teamCanCreateInstruction(_instrParentId)) return '';
  const level = _instrCurrentLevel();
  const actions = level === 'root'
    ? [{ type:'kcategory', icon:'🗂', label:'دسته‌بندی جدید' }]
    : [
        { type:'category', icon:'📁', label:'پوشه جدید' },
        { type:'note', icon:'📝', label:'یادداشت جدید' },
        { type:'checklist', icon:'✅', label:'چک‌لیست جدید' },
      ];
  return `
    <div class="instr-fab-spacer"></div>
    <div class="instr-fab-wrap" id="instr-fab-wrap">
      <div class="instr-fab-menu" id="instr-fab-menu">
        ${actions.map(a => `<button type="button" class="instr-fab-menu-item" onclick="_closeInstrFab();openAddInstruction(${level === 'root' ? 'null' : _instrParentLiteral()},${escapeAttr(a.type)})">
          <span>${escapeHtml(a.icon)}</span><span>${escapeHtml(a.label)}</span>
        </button>`).join('')}
      </div>
      <button type="button" class="instr-fab-btn" id="instr-fab-btn" onclick="_toggleInstrFab()">+</button>
    </div>`;
}
function _toggleInstrFab() {
  const menu = document.getElementById('instr-fab-menu');
  const btn = document.getElementById('instr-fab-btn');
  if (!menu || !btn) return;
  const open = menu.classList.toggle('open');
  btn.classList.toggle('open', open);
}
function _closeInstrFab() {
  const menu = document.getElementById('instr-fab-menu');
  const btn = document.getElementById('instr-fab-btn');
  if (menu) menu.classList.remove('open');
  if (btn) btn.classList.remove('open');
}
if (!window._instrFabOutsideClickBound) {
  window._instrFabOutsideClickBound = true;
  document.addEventListener('click', function(e) {
    if (!e.target.closest || !e.target.closest('#instr-fab-wrap')) _closeInstrFab();
  });
}

function _relTime(iso) {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff/60000);
    const hours = Math.floor(diff/3600000);
    const days  = Math.floor(diff/86400000);
    if (mins < 2)   return 'همین الان';
    if (mins < 60)  return fa(mins) + ' دقیقه پیش';
    if (hours < 24) return fa(hours) + ' ساعت پیش';
    if (days === 1) return 'دیروز';
    if (days < 30)  return fa(days) + ' روز پیش';
    return iso.slice(0,10);
  } catch(e){ return ''; }
}

function _instrHoverCard(el, color) {
  el.style.borderColor = color;
  el.style.transform   = 'translateY(-2px)';
  el.style.boxShadow   = `0 4px 20px ${color}22`;
}
function _instrUnhoverCard(el) {
  el.style.borderColor = '';
  el.style.transform   = '';
  el.style.boxShadow   = '';
}

/* ── انتخاب چندتایی: نگه‌داشتن انگشت روی کارت حالت انتخاب را فعال می‌کنه، بعد
   لمس ساده روی هر کارت فقط انتخاب/عدم‌انتخاب را toggle می‌کنه تا کاربر بتواند
   حذف گروهی، انتقال، تغییر برچسب، پین یا خروجی‌گیری گروهی انجام دهد. ── */
let _instrSelectMode = false;
let _instrSelectedIds = new Set();
let _instrLPTimer = null, _instrLPStartX = 0, _instrLPStartY = 0, _instrLPCard = null;

function _instrClearNativeSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.removeAllRanges) sel.removeAllRanges();
  } catch(e) {}
  try {
    if (document.selection && document.selection.empty) document.selection.empty();
  } catch(e) {}
}
function _instrEnterSelectMode(firstId) {
  if (_instrSelectMode) return;
  _instrClearNativeSelection();
  _instrSelectMode = true;
  document.body.classList.add('instr-select-mode');
  if (firstId != null) _instrToggleSelect(firstId, true);
  else _instrRenderBulkBar();
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch(e){} }
}
function _instrExitSelectMode() {
  _instrSelectMode = false;
  _instrSelectedIds.clear();
  _instrClearNativeSelection();
  document.body.classList.remove('instr-select-mode');
  document.querySelectorAll('._ifcard.instr-selected').forEach(c => c.classList.remove('instr-selected'));
  const bar = document.getElementById('instr-bulkbar');
  if (bar) bar.remove();
}
function _instrToggleSelect(id, forceOn) {
  _instrClearNativeSelection();
  id = +id;
  const card = document.querySelector('._ifcard[data-id="'+id+'"]');
  const on = forceOn === true ? true : !_instrSelectedIds.has(id);
  if (on) { _instrSelectedIds.add(id); if (card) card.classList.add('instr-selected'); }
  else { _instrSelectedIds.delete(id); if (card) card.classList.remove('instr-selected'); }
  if (_instrSelectedIds.size === 0) { _instrExitSelectMode(); return; }
  _instrRenderBulkBar();
}
function _instrRenderBulkBar() {
  let bar = document.getElementById('instr-bulkbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'instr-bulkbar';
    bar.id = 'instr-bulkbar';
    document.body.appendChild(bar);
  }
  const n = _instrSelectedIds.size;
  bar.innerHTML = `
    <button type="button" class="instr-bulkbar-btn" onclick="_instrExitSelectMode()" title="لغو انتخاب"><span class="ic">✕</span><span>${fa(n)} مورد</span></button>
    <button type="button" class="instr-bulkbar-btn" onclick="_instrBulkPin()"><span class="ic">📌</span><span>پین</span></button>
    <button type="button" class="instr-bulkbar-btn" onclick="_instrBulkMove()"><span class="ic">📁</span><span>انتقال</span></button>
    <button type="button" class="instr-bulkbar-btn" onclick="_instrBulkCopy()"><span class="ic">📋</span><span>کپی</span></button>
    <button type="button" class="instr-bulkbar-btn" onclick="_instrBulkLabel()"><span class="ic">🏷</span><span>برچسب</span></button>
    <button type="button" class="instr-bulkbar-btn" onclick="_instrBulkExport()"><span class="ic">📤</span><span>خروجی</span></button>
    <button type="button" class="instr-bulkbar-btn danger" onclick="_instrBulkDelete()"><span class="ic">🗑</span><span>حذف</span></button>`;
  requestAnimationFrame(() => bar.classList.add('open'));
}

/* Long-press detection: کار با موس و لمس هر دو، با آستانه‌ی جابه‌جایی برای این‌که
   اسکرول کردن صفحه به‌اشتباه حالت انتخاب را فعال نکنه. */
function _instrCardLPStart(e) {
  if (_instrSelectMode) return; // در حالت انتخاب، کلیک‌ها را handler دیگری مدیریت می‌کنه
  const card = e.target.closest && e.target.closest('._ifcard');
  if (!card || !card.dataset.id) return;
  if (e.target.closest('._ifcard-more-btn, ._ifcard-actions')) return;
  const pt = e.touches ? e.touches[0] : e;
  _instrLPStartX = pt.clientX; _instrLPStartY = pt.clientY;
  _instrLPCard = card;
  clearTimeout(_instrLPTimer);
  _instrLPTimer = setTimeout(function () {
    _instrLPTimer = null;
    if (_instrLPCard) _instrEnterSelectMode(+_instrLPCard.dataset.id);
  }, 480);
}
function _instrCardLPMove(e) {
  if (!_instrLPTimer) return;
  const pt = e.touches ? e.touches[0] : e;
  if (Math.abs(pt.clientX - _instrLPStartX) > 10 || Math.abs(pt.clientY - _instrLPStartY) > 10) {
    clearTimeout(_instrLPTimer); _instrLPTimer = null;
  }
}
function _instrCardLPEnd() {
  if (_instrLPTimer) { clearTimeout(_instrLPTimer); _instrLPTimer = null; }
  _instrLPCard = null;
}
if (!window._instrSelectBound) {
  window._instrSelectBound = true;
  document.addEventListener('mousedown', _instrCardLPStart, true);
  document.addEventListener('touchstart', _instrCardLPStart, { capture: true, passive: true });
  document.addEventListener('mousemove', _instrCardLPMove, true);
  document.addEventListener('touchmove', _instrCardLPMove, { capture: true, passive: true });
  document.addEventListener('mouseup', _instrCardLPEnd, true);
  document.addEventListener('touchend', _instrCardLPEnd, true);
  document.addEventListener('touchcancel', _instrCardLPEnd, true);
  document.addEventListener('selectstart', function (e) {
    if (e.target && e.target.closest && e.target.closest('._ifcard, .instr-bulkbar')) {
      e.preventDefault();
      _instrClearNativeSelection();
    }
  }, true);
  document.addEventListener('contextmenu', function (e) {
    if (e.target && e.target.closest && e.target.closest('._ifcard, .instr-bulkbar')) {
      e.preventDefault();
      _instrClearNativeSelection();
    }
  }, true);
  // در حالت انتخاب، کلیک روی کارت باید فقط toggle کنه، نه این‌که پوشه/یادداشت را باز کنه؛
  // چون در فاز capture قبل از رسیدن به onclick خود کارت اجرا می‌شه، جلوش را می‌گیریم.
  document.addEventListener('click', function (e) {
    if (!_instrSelectMode) return;
    const card = e.target.closest && e.target.closest('._ifcard');
    if (!card || !card.dataset.id) return;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    _instrToggleSelect(card.dataset.id);
  }, true);
}

/* ── اقدامات گروهی ── */
function _instrBulkPin() {
  if (!_db || !_db.instructions) return;
  const items = [..._instrSelectedIds].map(id => _db.instructions.find(x => x.id === id)).filter(Boolean);
  if (!items.length) return;
  const allPinned = items.every(x => x.pinned);
  items.forEach(x => { x.pinned = !allPinned; x.updated_at = new Date().toISOString(); });
  _save();
  showToast(allPinned ? 'پین برداشته شد' : '📌 پین شد', 'success');
  _instrExitSelectMode();
  renderInstructions();
}

function _instrBulkMove() {
  if (!_instrSelectedIds.size) return;
  _instrOpenTransferModal([..._instrSelectedIds], 'move');
}
function _instrBulkCopy() {
  if (!_instrSelectedIds.size) return;
  _instrOpenTransferModal([..._instrSelectedIds], 'copy');
}
function _instrSelectedRootIds(ids) {
  const idSet = new Set((ids || []).map(Number).filter(Boolean));
  return [...idSet].filter(id => {
    let cur = (_db.instructions || []).find(x => +x.id === +id);
    while (cur && cur.parent_id) {
      if (idSet.has(+cur.parent_id)) return false;
      cur = (_db.instructions || []).find(x => +x.id === +cur.parent_id);
    }
    return true;
  });
}
function _instrIsContainerNode(node) {
  return !!node && (node.type === 'category' || node.type === 'kcategory');
}
function _instrTargetLabel(targetId) {
  if (!targetId) return 'ریشه مرکز دانش';
  const node = (_db.instructions || []).find(x => +x.id === +targetId);
  if (!node) return '';
  const parts = _instrAncestors(node.id).map(x => `${x.icon || '📁'} ${x.title}`);
  parts.push(`${node.icon || '📁'} ${node.title}`);
  return parts.join(' / ');
}
function _instrIsDescendantOf(nodeId, ancestorId) {
  let cur = (_db.instructions || []).find(x => +x.id === +nodeId);
  while (cur && cur.parent_id) {
    if (+cur.parent_id === +ancestorId) return true;
    cur = (_db.instructions || []).find(x => +x.id === +cur.parent_id);
  }
  return false;
}
function _instrCanPlaceInTarget(item, targetId) {
  if (!item) return false;
  if (targetId === null || targetId === undefined || targetId === '') {
    return item.type === 'kcategory' && _teamCanCreateInstruction(null);
  }
  const target = (_db.instructions || []).find(x => +x.id === +targetId);
  if (!_instrIsContainerNode(target)) return false;
  if (!_teamCanCreateInstruction(+targetId)) return false;
  if (item.type === 'kcategory') return false;
  // یادداشت‌ها و پوشه‌ها می‌توانند مستقیماً داخل یک دسته‌بندی (kcategory) هم قرار بگیرند؛
  // دیگر لازم نیست از قبل حتماً پوشه‌ای داخل آن دسته‌بندی ساخته شده باشد.
  return true;
}
function _instrTransferDestinationOptions(rootIds) {
  const roots = (rootIds || []).map(id => (_db.instructions || []).find(x => +x.id === +id)).filter(Boolean);
  const rootSet = new Set(roots.map(x => +x.id));
  const opts = [];
  if (roots.length && roots.every(x => _instrCanPlaceInTarget(x, null)) && _teamCanCreateInstruction(null)) {
    opts.push({ id:null, icon:'🏠', title:'ریشه مرکز دانش', path:'سطح اول دسته‌بندی‌ها', depth:0 });
  }
  (_db.instructions || [])
    .filter(_instrIsContainerNode)
    .sort((a,b) => _instrTargetLabel(a.id).localeCompare(_instrTargetLabel(b.id), 'fa'))
    .forEach(target => {
      if (rootSet.has(+target.id)) return;
      const invalid = roots.some(item =>
        !_instrCanPlaceInTarget(item, target.id) ||
        +item.id === +target.id ||
        _instrIsDescendantOf(target.id, item.id)
      );
      if (invalid) return;
      opts.push({
        id:+target.id,
        icon:target.icon || (target.type === 'kcategory' ? '🗂' : '📁'),
        title:target.title,
        path:_instrTargetLabel(target.id),
        depth:Math.min(_instrAncestors(target.id).length, 4)
      });
    });
  return opts;
}
function _instrUniqueCopyTitle(title, parentId) {
  const base = `${title || 'بدون عنوان'} (کپی)`;
  const siblings = (_db.instructions || []).filter(x => {
    const a = x.parent_id ? +x.parent_id : null;
    const b = parentId ? +parentId : null;
    return a === b;
  }).map(x => x.title);
  if (!siblings.includes(base)) return base;
  let i = 2;
  while (siblings.includes(`${title || 'بدون عنوان'} (کپی ${fa(i)})`)) i++;
  return `${title || 'بدون عنوان'} (کپی ${fa(i)})`;
}
function _instrCloneSubtree(sourceId, newParentId, isRoot) {
  const items = _db.instructions || [];
  const src = items.find(x => +x.id === +sourceId);
  if (!src || !_teamCanInstructionNode(src.id)) return null;
  const now = new Date().toISOString();
  const children = items.filter(x => x.parent_id && +x.parent_id === +src.id).map(x => +x.id);
  const clone = JSON.parse(JSON.stringify(src));
  clone.id = _instrNextLocalId();
  clone.parent_id = newParentId == null ? null : +newParentId;
  clone.title = isRoot ? _instrUniqueCopyTitle(src.title, clone.parent_id) : src.title;
  clone.created_at = now;
  clone.updated_at = now;
  clone.pinned = false;
  if (clone.type === 'kcategory') delete clone.kcat_key;
  items.push(clone);
  children.forEach(childId => _instrCloneSubtree(childId, clone.id, false));
  return clone;
}
function _instrOpenTransferModal(ids, mode) {
  if (!_db || !_db.instructions) return;
  const rootIds = _instrSelectedRootIds(ids).filter(id => {
    const item = _db.instructions.find(x => +x.id === +id);
    return item && _teamCanInstructionNode(id);
  });
  if (!rootIds.length) { showToast('مورد قابل انتقالی انتخاب نشده', 'error'); return; }
  const op = mode === 'copy' ? 'copy' : 'move';
  const title = op === 'copy' ? '📋 کپی به...' : '📁 انتقال به...';
  const verb = op === 'copy' ? 'کپی' : 'انتقال';
  const options = _instrTransferDestinationOptions(rootIds);
  const selectedPreview = rootIds.map(id => {
    const item = _db.instructions.find(x => +x.id === +id);
    return item ? `<span style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border2);background:var(--bg3);border-radius:999px;padding:4px 9px;font-size:11px;color:var(--text2)">${escapeHtml(item.icon || (item.type === 'category' ? '📁' : '📝'))} ${escapeHtml(item.title)}</span>` : '';
  }).join('');
  const optionsHtml = options.map(opt => {
    const idArg = opt.id == null ? 'null' : opt.id;
    // ساخت پوشهٔ جدید فقط داخل یک دسته‌بندی/پوشهٔ واقعی معنا دارد، نه در ریشهٔ مرکز دانش
    const canMakeFolderHere = opt.id != null;
    const searchKey = `${escapeHtml(opt.title || '')} ${opt.path || ''}`.toLowerCase();
    return `
      <div class="_instrTransferOpt" data-search="${escapeHtml(searchKey)}" style="display:flex;align-items:stretch;gap:6px;margin-bottom:7px">
        <button type="button" onclick="_instrConfirmTransfer('${op}', ${idArg})"
          style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;text-align:right;padding:11px 12px;border-radius:10px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);cursor:pointer"
          onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background='var(--bg2)'">
          <span style="width:26px;height:26px;border-radius:8px;background:rgba(124,106,247,.14);display:flex;align-items:center;justify-content:center;flex-shrink:0">${escapeHtml(opt.icon)}</span>
          <span style="flex:1;min-width:0;padding-right:${opt.depth * 12}px">
            <strong style="display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(opt.title)}</strong>
            <small style="display:block;color:var(--text3);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px">${escapeHtml(opt.path)}</small>
          </span>
          <span style="color:var(--purple);font-size:15px">‹</span>
        </button>
        ${canMakeFolderHere ? `
        <button type="button" title="ساخت پوشهٔ جدید داخل «${escapeHtml(opt.title)}» و ${verb} به آن" onclick="_instrCreateFolderAndTransfer(${idArg})"
          style="flex-shrink:0;width:42px;border-radius:10px;border:1px dashed var(--border2);background:var(--bg2);color:var(--text2);cursor:pointer;font-size:16px"
          onmouseover="this.style.background='var(--bg3)';this.style.color='var(--text)'" onmouseout="this.style.background='var(--bg2)';this.style.color='var(--text2)'">📁+</button>` : ''}
      </div>`;
  }).join('');
  window._instrPendingTransfer = { ids: rootIds, mode: op };
  openModal(title, `
    <div style="display:grid;gap:12px">
      <div style="border:1px solid var(--border);background:linear-gradient(135deg,rgba(124,106,247,.12),rgba(62,207,142,.08));border-radius:12px;padding:12px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">${verb} ${fa(rootIds.length)} مورد انتخاب‌شده</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${selectedPreview}</div>
      </div>
      <div style="font-size:12px;color:var(--text3)">مقصد را انتخاب کن؛ نیازی نیست از قبل پوشه‌ای در آن ساخته شده باشد. پوشه‌ها همراه با تمام زیرپوشه‌ها و یادداشت‌های داخلشان ${op === 'copy' ? 'کپی می‌شوند' : 'منتقل می‌شوند'}. با دکمهٔ 📁+ هم می‌توانید همین‌جا یک پوشهٔ جدید بسازید و مستقیماً داخل آن ${verb} کنید.</div>
      <div style="position:relative">
        <input type="text" id="_instrTransferSearch" placeholder="🔍 جستجو بین پوشه‌ها و دسته‌بندی‌ها..." oninput="_instrFilterTransferOptions(this.value)"
          style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--border2);background:var(--bg2);color:var(--text);font-size:13px;outline:none"
          onfocus="this.style.borderColor='var(--purple)'" onblur="this.style.borderColor='var(--border2)'">
      </div>
      <div id="_instrTransferOptionsWrap" style="max-height:min(420px,55vh);overflow:auto;padding-left:3px">
        ${optionsHtml || '<p style="font-size:12px;color:var(--text3);text-align:center;padding:18px 0;border:1px dashed var(--border2);border-radius:12px">مقصد معتبری برای این انتخاب وجود ندارد.</p>'}
        <p id="_instrTransferNoMatch" style="display:none;font-size:12px;color:var(--text3);text-align:center;padding:18px 0;border:1px dashed var(--border2);border-radius:12px">نتیجه‌ای یافت نشد.</p>
      </div>
    </div>`, [
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
  setTimeout(() => { const s = document.getElementById('_instrTransferSearch'); if (s) s.focus(); }, 50);
}
function _instrFilterTransferOptions(query) {
  const q = (query || '').trim().toLowerCase();
  const wrap = document.getElementById('_instrTransferOptionsWrap');
  if (!wrap) return;
  const rows = wrap.querySelectorAll('._instrTransferOpt');
  let visibleCount = 0;
  rows.forEach(row => {
    const match = !q || (row.getAttribute('data-search') || '').includes(q);
    row.style.display = match ? '' : 'none';
    if (match) visibleCount++;
  });
  const noMatch = document.getElementById('_instrTransferNoMatch');
  if (noMatch) noMatch.style.display = (rows.length && !visibleCount) ? '' : 'none';
}
function _instrCreateFolderAndTransfer(parentId) {
  const pending = window._instrPendingTransfer;
  if (!pending) return;
  const pId = (parentId === null || parentId === undefined || parentId === 'null' || parentId === '') ? null : +parentId;
  if (pId == null) return; // ساخت پوشه در ریشهٔ مرکز دانش معنا ندارد
  if (!_teamCanCreateInstruction(pId)) { showToast('برای ساختن پوشه در این مقصد دسترسی نداری', 'error'); return; }
  const title = (window.prompt('نام پوشهٔ جدید:') || '').trim();
  if (!title) return;
  const now = new Date().toISOString();
  const folder = {
    id: _instrNextLocalId(),
    parent_id: pId,
    type: 'category',
    title,
    icon: '📁',
    color: '#7c6af7',
    created_at: now,
    updated_at: now,
  };
  if (!_db.instructions) _db.instructions = [];
  _db.instructions.push(folder);
  _instrConfirmTransfer(pending.mode, folder.id);
}
function _instrConfirmTransfer(mode, targetId) {
  const pending = window._instrPendingTransfer || {};
  const ids = _instrSelectedRootIds(pending.ids || [..._instrSelectedIds]);
  const op = mode || pending.mode || 'move';
  const items = ids.map(id => (_db.instructions || []).find(x => +x.id === +id)).filter(Boolean);
  if (!items.length) return;
  const dest = targetId == null ? null : +targetId;
  const invalid = items.some(item => !_teamCanInstructionNode(item.id) || !_teamCanCreateInstruction(dest) || !_instrCanPlaceInTarget(item, dest) || (dest && (+item.id === dest || _instrIsDescendantOf(dest, item.id))));
  if (invalid) { showToast('این مقصد برای مورد انتخاب‌شده مجاز نیست', 'error'); return; }
  if (op === 'copy') {
    items.forEach(item => _instrCloneSubtree(item.id, dest, true));
  } else {
    items.forEach(item => { item.parent_id = dest; item.updated_at = new Date().toISOString(); });
  }
  _save();
  closeModal();
  window._instrPendingTransfer = null;
  showToast(op === 'copy' ? 'کپی ساخته شد ✓' : 'منتقل شد ✓', 'success');
  _instrExitSelectMode();
  renderInstructions();
}
function _confirmBulkMove(targetId) {
  _instrConfirmTransfer('move', targetId);
}
function _instrLegacyBulkMove() {
  if (!_instrSelectedIds.size) return;
  const idSet = new Set(_instrSelectedIds);
  function isDescendantOfSelected(nodeId) {
    let cur = (_db.instructions || []).find(x => x.id === nodeId);
    while (cur && cur.parent_id) {
      if (idSet.has(+cur.parent_id)) return true;
      cur = (_db.instructions || []).find(x => x.id === +cur.parent_id);
    }
    return false;
  }
  const folders = (_db.instructions || []).filter(x => (x.type === 'category' || x.type === 'kcategory') && !idSet.has(x.id) && !isDescendantOfSelected(x.id));
  const optionsHtml = folders.map(f => `
    <div onclick="_confirmBulkMove(${f.id})" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--border2);margin-bottom:6px" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
      <span>${escapeHtml(f.icon || '📁')}</span><span style="font-size:13px">${escapeHtml(f.title)}</span>
    </div>`).join('');
  openModal('📁 انتقال به پوشه', `
    <p style="font-size:12px;color:var(--text3);margin-bottom:10px">مقصد را برای ${fa(_instrSelectedIds.size)} مورد انتخاب‌شده مشخص کن.</p>
    <div style="max-height:320px;overflow-y:auto">
      <div onclick="_confirmBulkMove(null)" style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--border2);margin-bottom:6px" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
        <span>🏠</span><span style="font-size:13px">ریشه (مرکز دانش)</span>
      </div>
      ${optionsHtml || '<p style="font-size:12px;color:var(--text3);text-align:center;padding:10px 0">پوشه‌ی دیگری وجود ندارد</p>'}
    </div>`, [
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}

function _instrBulkLabel() {
  const colorOpts = ['#7c6af7','#3ecf8e','#f87171','#60a5fa','#fbbf24','#f472b6','#34d399','#a78bfa','#fb923c','#06b6d4'].map(c =>
    `<div onclick="_confirmBulkLabel('${c}')" style="width:36px;height:36px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0" onmouseover="this.style.outline='3px solid var(--text)'" onmouseout="this.style.outline='none'"></div>`
  ).join('');
  openModal('🏷 تغییر برچسب رنگی', `
    <p style="font-size:12px;color:var(--text3);margin-bottom:12px">رنگ جدید برای ${fa(_instrSelectedIds.size)} مورد انتخاب‌شده را انتخاب کن.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">${colorOpts}</div>`, [
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}
function _confirmBulkLabel(color) {
  const ids = [..._instrSelectedIds];
  ids.forEach(id => {
    const item = (_db.instructions || []).find(x => x.id === id);
    if (item && _teamCanInstructionNode(id)) { item.color = color; item.updated_at = new Date().toISOString(); }
  });
  _save();
  closeModal();
  showToast('برچسب تغییر کرد ✓', 'success');
  _instrExitSelectMode();
  renderInstructions();
}

function _instrBulkExport() {
  const ids = [..._instrSelectedIds];
  if (!ids.length) return;
  function collect(id) {
    const node = (_db.instructions || []).find(x => x.id === id);
    if (!node) return [];
    let list = [node];
    if (node.type === 'category' || node.type === 'kcategory') {
      (_db.instructions || []).filter(x => x.parent_id === node.id).forEach(c => { list = list.concat(collect(c.id)); });
    }
    return list;
  }
  let allNodes = [];
  ids.forEach(id => { allNodes = allNodes.concat(collect(id)); });
  const seen = new Set();
  allNodes = allNodes.filter(n => { if (seen.has(n.id)) return false; seen.add(n.id); return true; });

  let text = '';
  allNodes.forEach(n => {
    if (n.type === 'category' || n.type === 'kcategory') {
      text += `\n\n# ${n.icon || '📁'} ${n.title}\n`;
    } else {
      text += `\n\n## ${n.icon || '📝'} ${n.title}\n`;
      if (n.content) text += n.content + '\n';
      if (n.extra_note) text += '\n' + n.extra_note + '\n';
    }
  });
  const blob = new Blob([text.trim() || 'موردی برای خروجی وجود ندارد'], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'خروجی-مرکز-دانش.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  showToast('خروجی گرفته شد ✓', 'success');
  _instrExitSelectMode();
}

function _instrBulkDelete() {
  const ids = [..._instrSelectedIds];
  if (!ids.length) return;
  const n = ids.length;
  openModal('⚠️ تأیید حذف گروهی', `
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:36px;margin-bottom:12px">🗑️</div>
      <p style="font-size:14px;color:var(--text);margin-bottom:8px">آیا از حذف <strong>${fa(n)} مورد</strong> انتخاب‌شده مطمئن هستید؟</p>
      <p style="font-size:12px;color:var(--text3);margin-top:10px">پوشه‌های انتخاب‌شده همراه با تمام زیرشاخه‌هایشان حذف می‌شوند. این عملیات قابل بازگشت نیست.</p>
    </div>`, [
    { label: '🗑️ بله، حذف شوند', cls: 'btn-primary" style="background:var(--red);border-color:var(--red)', action: '_confirmBulkDelete()' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}
async function _confirmBulkDelete() {
  const ids = [..._instrSelectedIds];
  closeModal();
  for (const id of ids) {
    if (!_teamCanInstructionNode(id)) continue;
    if (window.api && window.api.instructions) {
      await window.api.instructions.delete(id);
    } else {
      const ds = new Set();
      (function dc(x) { ds.add(x); (_db.instructions || []).filter(n => n.parent_id == x).forEach(n => dc(n.id)); })(id);
      _db.instructions = (_db.instructions || []).filter(n => !ds.has(n.id));
    }
  }
  _forceNextServerSync();
  _save();
  clearTimeout(window._serverSyncTimer);
  _syncToServer();
  showToast('موارد انتخاب‌شده حذف شدند', 'error');
  _instrExitSelectMode();
  renderInstructions();
}

function _instrTogglePin(id) {
  if (!_db.instructions) return;
  if (!_teamCanInstructionNode(id)) { showToast('به این مورد دسترسی نداری', 'error'); return; }
  const item = _db.instructions.find(x => x.id === +id);
  if (!item) return;
  item.pinned = !item.pinned;
  _save();
  showToast(item.pinned ? '📌 پین شد' : 'پین برداشته شد', 'success');
  renderInstructions();
}

/* ── Card action menu (edit/pin/delete, quick-add) — tap-to-reveal instead of hover ──
   On touch devices, :hover doesn't exist, so relying on it made the FIRST tap on a
   folder/note card only "reveal" these buttons instead of opening it (iOS's ghost-hover
   behavior) — a second tap was needed to actually navigate. The card's main onclick
   still fires immediately on tap; this "⋮" button is a separate, always-tappable
   target for the secondary actions, with its own stopPropagation. ── */
function _ifToggleActions(btn) {
  if (window.event) window.event.stopPropagation();
  const card = btn.closest('._ifcard');
  if (!card) return;
  const wasOpen = card.classList.contains('show-actions');
  document.querySelectorAll('._ifcard.show-actions').forEach(c => c.classList.remove('show-actions'));
  if (!wasOpen) card.classList.add('show-actions');
}
if (!window._ifActionsOutsideClickBound) {
  window._ifActionsOutsideClickBound = true;
  document.addEventListener('click', function (e) {
    if (!e.target.closest('._ifcard-more-btn')) {
      document.querySelectorAll('._ifcard.show-actions').forEach(c => c.classList.remove('show-actions'));
    }
  });
}

function _instrOpenFolder(id, icon, title) {
  if (!_teamCanInstructionNode(id)) { showToast('به این پوشه دسترسی نداری', 'error'); return; }
  const contentEl = document.querySelector('.content');
  if (contentEl && history.state && history.state.instrNav) {
    history.replaceState(Object.assign({}, history.state, {scrollTop: contentEl.scrollTop}), '');
  }
  _instrPath.push({id, icon, title});
  _instrParentId = id;
  _instrPushHistory();
  renderInstructions();
}

/* ── Jump to an arbitrary point in the folder path (breadcrumb / home button) ──
   Pushed as a new history entry too, so the hardware/gesture back button always
   steps back exactly one place the user has actually been — never closes the app. */
function _instrGoTo(parentId, path) {
  const contentEl = document.querySelector('.content');
  if (contentEl && history.state && history.state.instrNav) {
    history.replaceState(Object.assign({}, history.state, {scrollTop: contentEl.scrollTop}), '');
  }
  _instrParentId = parentId;
  _instrPath = path || [];
  _instrPushHistory();
  renderInstructions();
}

function _instrCrumbGo(el) {
  if (!el) return;
  const parentValue = el.dataset.instrParent;
  let path = [];
  try { path = JSON.parse(decodeURIComponent(el.dataset.instrPath || '%5B%5D')); } catch (e) {}
  _instrGoTo(parentValue === '' ? null : +parentValue, path);
}

function _instrPushHistory() {
  try {
    const state = {instrNav: true, parentId: _instrParentId, path: JSON.parse(JSON.stringify(_instrPath))};
    const hash = _instrParentId ? ('#instructions/' + _instrParentId) : '#instructions';
    history.pushState(state, '', hash);
  } catch (e) {}
}

/* ── Keep the knowledge-center topbar simple; folder navigation lives in-page. ── */
function _instrSetHeaderNav(inFolder, title) {
  const hb = document.getElementById('hamburger-btn');
  if (hb) {
    hb.dataset.role = 'menu';
    hb.textContent = '☰';
    hb.classList.remove('open');
    hb.onclick = toggleSidebar;
    hb.title = '';
  }
  const pt = document.getElementById('page-title');
  if (pt && currentPage === 'instructions') pt.textContent = 'مرکز دانش';
}

/* ── Hardware/gesture back button (Android back, browser back) drives the folder stack
   instead of closing the app, and restores scroll position where we left off ── */
if (!window._instrPopstateBound) {
  window._instrPopstateBound = true;
  window.addEventListener('popstate', function (e) {
    const st = e.state;
    if (st && st.instrNav) {
      _instrParentId = st.parentId;
      _instrPath = st.path || [];
    } else {
      _instrParentId = null;
      _instrPath = [];
    }
    if (typeof currentPage !== 'undefined' && currentPage === 'instructions') {
      renderInstructions().then(function () {
        if (st && typeof st.scrollTop === 'number') {
          const contentEl = document.querySelector('.content');
          if (contentEl) contentEl.scrollTop = st.scrollTop;
        }
      });
    }
  });
}

// ── Note detail (rich view) ───────────────────────────────────────────────
function openNoteDetail(id) {
  const numId = +id;
  const node = (_db.instructions||[]).find(n => n.id === numId);
  if (!node) { showToast('یادداشت پیدا نشد','error'); return; }
  if (!_teamCanInstructionNode(numId)) { showToast('به این یادداشت دسترسی نداری', 'error'); return; }

  const stickers = node.stickers || [];
  const stickerBtns = ['⭐','🔥','💡','✅','❗','🚀','🎯','🔑','📌','💰','⚠️','🎉','🔒','💻','📱','🌟','🏆','🔔','💎','🎵']
    .map(s => `<button onclick="_toggleNoteSticker(${id},'${s}',this)"
      style="font-size:16px;width:32px;height:32px;border-radius:7px;border:1px solid ${stickers.includes(s)?'var(--accent)':'var(--border)'};background:${stickers.includes(s)?'rgba(124,106,247,.15)':'var(--bg3)'};cursor:pointer;transition:all .15s">${s}</button>`).join('');

  const isKey = node.importance === 'key';
  const dateStr = node.date_jalali ? `<div class="detail-row"><span class="detail-key">📅 تاریخ</span><span class="detail-val">${DateService.disp(node.date_jalali)}</span></div>` : '';
  const impStr = `<div class="detail-row"><span class="detail-key">اهمیت</span><span class="detail-val">${isKey?'<span style="color:var(--amber);font-weight:600">⭐ مهم و کلیدی</span>':'معمولی'}</span></div>`;
  const statusMap = { active:'در حال انجام', done:'انجام شده', paused:'متوقف' };
  const statusStr = `<div class="detail-row"><span class="detail-key">وضعیت</span><span class="detail-val">${statusMap[node.status||'active'] || 'در حال انجام'}</span></div>`;
  const authorStr = node.author ? `<div class="detail-row"><span class="detail-key">نویسنده</span><span class="detail-val">${escapeHtml(node.author)}</span></div>` : '';
  const tagsStr = _instrTagsHtml(node.tags||[]);

  openModal(`${escapeHtml(node.icon||'📝')} ${escapeHtml(node.title)}`, `
    <div id="note-sticker-display-${id}" style="font-size:20px;letter-spacing:3px;margin-bottom:${stickers.length?'8':'0'}px">${stickers.join(' ')}</div>
    <div class="detail-section" style="${isKey?'border-color:var(--amber);background:rgba(251,191,36,.04)':''}">
      ${dateStr}${impStr}${statusStr}${authorStr}
      ${tagsStr ? `<div style="margin-top:10px">${tagsStr}</div>` : ''}
    </div>
    <div class="detail-section">
      <h3>📄 محتوا</h3>
      <div style="margin-top:10px;font-size:13px;color:var(--text);line-height:1.9;white-space:pre-wrap">${renderRich(node.content, {interactive:true,noteId:numId,field:'content'}) || '<span style="color:var(--text3)">محتوایی ثبت نشده</span>'}</div>
    </div>
    ${node.extra_note ? `
    <div class="detail-section">
      <h3>📎 یادداشت تکمیلی</h3>
      <div style="margin-top:10px;font-size:13px;color:var(--text);line-height:1.9;white-space:pre-wrap">${renderRich(node.extra_note, {interactive:true,noteId:numId,field:'extra_note'})}</div>
    </div>` : ''}
    <div class="detail-section">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <h3>📎 پیوست‌ها</h3>
        <button class="btn btn-ghost btn-sm" onclick="_triggerAttach('instruction',${id})">+ افزودن فایل</button>
      </div>
      ${(node.attachments||[]).length === 0
        ? '<p style="font-size:12px;color:var(--text3)">هنوز پیوستی اضافه نشده</p>'
        : renderAttachmentsGrid(node.attachments||[], `(fid)=>_deleteAttachment('instruction',${id},fid)`)}
    </div>
    <div class="detail-section">
      <h3 style="margin-bottom:10px">🏷 استیکر</h3>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${stickerBtns}</div>
    </div>
  `, [
    { label: '✏️ ویرایش', cls: 'btn-primary', action: `closeModal();openEditInstruction(${id})`, style: 'min-width:0;padding:8px 16px;font-size:12.5px;box-shadow:none' },
    { label: '📋 کپی', cls: 'btn-ghost', action: `copyInstructionText(${id})`, style: 'min-width:0;padding:8px 16px;font-size:12.5px' },
    { label: 'بستن', cls: 'btn-ghost', action: 'closeModal()' },
    { label: '🗑 حذف', cls: 'btn-danger', action: `closeModal();deleteInstruction(${id})`, style: 'margin-left:auto' },
  ]);
}

function copyInstructionText(id) {
  const node = (_db.instructions || []).find(function(item) { return +item.id === +id; });
  if (!node) { showToast('متن برای کپی پیدا نشد', 'error'); return; }
  const parts = [];
  if (node.title) parts.push('# ' + node.title.trim());
  if (node.content && node.content.trim()) parts.push(node.content.trim());
  if (node.extra_note && node.extra_note.trim()) {
    parts.push('یادداشت تکمیلی:\n' + node.extra_note.trim());
  }
  const text = parts.join('\n\n');
  if (!text) { showToast('متنی برای کپی وجود ندارد', 'error'); return; }
  copyToClipboard(text, 'متن و فرم کپی شد ✓');
}

async function _toggleNoteSticker(id, sticker, btn) {
  const node = (_db.instructions||[]).find(n => n.id === +id);
  if (!node) return;
  if (!node.stickers) node.stickers = [];
  const idx = node.stickers.indexOf(sticker);
  if (idx >= 0) {
    node.stickers.splice(idx, 1);
    btn.style.border = '1px solid var(--border)';
    btn.style.background = 'var(--bg3)';
  } else {
    node.stickers.push(sticker);
    btn.style.border = '1px solid var(--accent)';
    btn.style.background = 'rgba(124,106,247,.15)';
  }
  _save();
  const displayEl = document.getElementById('note-sticker-display-' + id);
  if (displayEl) displayEl.textContent = (node.stickers || []).join(' ');
}

// Icons for picker
const INSTR_ICONS = ['📝','📋','🔑','💼','🎯','💡','📌','🔒','🌐','📱','💰','🏆','⚙️','📊','🎨','📚','🔗','💻','🔔','📧','🗺️','🎪','🧩','🛡️','🚀','📁','⭐','🔥','🌟','✅'];

/* ── Progressive-disclosure helpers for the note/folder form ── */
function _toggleAdvanced(sectionId, btnId) {
  const el = document.getElementById(sectionId);
  const btn = document.getElementById(btnId);
  if (!el) return;
  const willShow = el.style.display === 'none';
  el.style.display = willShow ? 'block' : 'none';
  if (btn) btn.textContent = willShow
    ? 'تنظیمات کمتر ▴'
    : 'تنظیمات بیشتر (آیکون، رنگ، اهمیت، تاریخ، یادداشت تکمیلی) ▾';
}
function _setImportanceChip(inputId, value, btn) {
  const input = document.getElementById(inputId);
  if (input) input.value = value;
  const group = btn.parentElement;
  group.querySelectorAll('.imp-chip').forEach(function(b) {
    b.style.background = 'var(--bg3)';
    b.style.color = 'var(--text2)';
    b.style.borderColor = 'var(--border2)';
  });
  btn.style.background = value === 'key' ? 'rgba(251,191,36,.15)' : 'rgba(124,106,247,.15)';
  btn.style.color = value === 'key' ? 'var(--amber)' : 'var(--accent2)';
  btn.style.borderColor = value === 'key' ? 'var(--amber)' : 'var(--accent)';
}
function _impChipsHtml(inputId, selected) {
  const items = [['normal','○ معمولی'], ['key','⭐ مهم']];
  return `<input type="hidden" id="${inputId}" value="${selected}">
    <div style="display:flex;gap:6px">
      ${items.map(function(pair) {
        const val = pair[0], label = pair[1];
        const active = val === selected;
        const border = active ? (val==='key' ? 'var(--amber)' : 'var(--accent)') : 'var(--border2)';
        const bg = active ? (val==='key' ? 'rgba(251,191,36,.15)' : 'rgba(124,106,247,.15)') : 'var(--bg3)';
        const color = active ? (val==='key' ? 'var(--amber)' : 'var(--accent2)') : 'var(--text2)';
        return `<button type="button" class="imp-chip" onclick="_setImportanceChip('${inputId}','${val}',this)" style="padding:7px 14px;border-radius:20px;border:1px solid ${border};background:${bg};color:${color};font-size:12px;font-weight:600;cursor:pointer;font-family:var(--font)">${label}</button>`;
      }).join('')}
    </div>`;
}

function openAddInstruction(parentId, type) {
  if (!window._openingStaffInstruction) _staffInstructionContext = null;
  if (!_teamCanCreateInstruction(parentId)) { showToast('برای ساختن مورد جدید در این پوشه دسترسی نداری', 'error'); return; }
  if (!type) type = 'note';
  const iconBtns = INSTR_ICONS.map(i =>
    `<button type="button" onclick="document.getElementById('instr-icon').value='${i}';document.querySelectorAll('.icon-pick-btn').forEach(b=>b.style.background='var(--bg3)');this.style.background='var(--accent2)33'" class="icon-pick-btn" style="width:34px;height:34px;font-size:16px;border-radius:8px;border:1px solid var(--border2);background:var(--bg3);cursor:pointer">${i}</button>`
  ).join('');
  const colorOpts = ['#7c6af7','#3ecf8e','#f87171','#60a5fa','#fbbf24','#f472b6','#34d399','#a78bfa','#fb923c','#06b6d4'].map(c =>
    `<div onclick="document.getElementById('instr-color').value='${c}';document.querySelectorAll('.color-pick-dot').forEach(d=>d.style.outline='none');this.style.outline='3px solid var(--text)'" class="color-pick-dot" style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0"></div>`
  ).join('');

  const defaultIcon = type === 'kcategory' ? '🗂' : (type === 'category' ? '📁' : (type === 'checklist' ? '✅' : '📝'));
  const pholder = type === 'kcategory' ? 'مثلاً: مالی، طراحی، منابع' : (type === 'category' ? 'مثلاً: پسوردها، ایده‌های کسب‌وکار' : (type === 'checklist' ? 'مثلاً: چک‌لیست شروع پروژه' : 'مثلاً: نکاتی که امروز یاد گرفتم'));
  const modalTitle = type === 'kcategory' ? '🗂 دسته‌بندی جدید' : (type === 'category' ? '📁 پوشه جدید' : (type === 'checklist' ? '✅ چک‌لیست جدید' : '📝 یادداشت جدید'));
  const _pId = (parentId && parentId !== 'null') ? +parentId : null;
  /* چک‌لیست از نظر ساختار داده همان «یادداشت» است، فقط محتوای اولیه‌اش با چند خط
     «[ ] ...» پر می‌شه تا کاربر مستقیم آیتم‌ها را تایپ کنه؛ ذخیره هم مثل note انجام می‌شه */
  const isChecklist = type === 'checklist';

  const iconColorBlock = `
    <div class="form-group full">
      <label class="form-label">آیکون</label>
      <input type="hidden" id="instr-icon" value="${defaultIcon}">
      <div style="display:flex;flex-wrap:wrap;gap:5px">${iconBtns}</div>
    </div>
    <div class="form-group full">
      <label class="form-label">رنگ</label>
      <input type="hidden" id="instr-color" value="#7c6af7">
      <div style="display:flex;gap:8px;flex-wrap:wrap">${colorOpts}</div>
    </div>`;

  let bodyHtml;
  if (type === 'category' || type === 'kcategory') {
    /* ── Categories/Folders: just 3 fields, nothing to hide ── */
    bodyHtml = `
      <div class="form-group full">
        <label class="form-label">عنوان *</label>
        <input class="form-input" id="instr-title" placeholder="${pholder}" autofocus>
      </div>
      ${iconColorBlock}`;
  } else {
    /* ── Notes: title + content up front; everything else behind a toggle ── */
    bodyHtml = `
      <div class="form-group full">
        <label class="form-label">عنوان *</label>
        <input class="form-input" id="instr-title" placeholder="${pholder}" autofocus>
      </div>
      <div class="form-group full note-content-wrap">
        <label class="form-label">${isChecklist ? '✅ آیتم‌های چک‌لیست' : '📄 محتوا'}</label>
        ${richToolbar('instr-content')}
        <textarea class="form-textarea note-content-textarea" id="instr-content" rows="6" placeholder="${isChecklist ? 'هر خط یک آیتم — مثلاً: خرید بلیط' : 'محتوای یادداشت...'}">${isChecklist ? '[ ] \n[ ] \n[ ] ' : ''}</textarea>
      </div>
      <div class="form-group full">
        <button type="button" id="instr-adv-toggle" onclick="_toggleAdvanced('instr-advanced','instr-adv-toggle')"
          style="width:100%;text-align:center;padding:9px;border-radius:8px;border:1px dashed var(--border2);background:none;color:var(--text2);font-size:12px;font-family:var(--font);cursor:pointer">
          تنظیمات بیشتر (آیکون، رنگ، اهمیت، تاریخ، یادداشت تکمیلی) ▾
        </button>
      </div>
      <div id="instr-advanced" style="display:none" class="form-group full">
        <div class="form-grid">
          ${iconColorBlock}
          <div class="form-group">
            <label class="form-label">اهمیت</label>
            ${_impChipsHtml('instr-importance','normal')}
          </div>
          <div class="form-group">
            <label class="form-label">وضعیت</label>
            <select class="form-input" id="instr-status">
              <option value="active">در حال انجام</option>
              <option value="done">انجام شده</option>
              <option value="paused">متوقف</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">📅 تاریخ (شمسی)</label>
            <input class="form-input jdate" id="instr-date" value="${formatJalali(...todayJalali())}">
          </div>
          <div class="form-group full">
            <label class="form-label">🏷 برچسب‌ها</label>
            <input class="form-input" id="instr-tags" placeholder="مثلاً: UI، UX، مهم، در حال انجام">
          </div>
          <div class="form-group full">
            <label class="form-label">📝 یادداشت تکمیلی</label>
            ${richToolbar('instr-extra')}
            <textarea class="form-textarea" id="instr-extra" rows="3" placeholder="نکات تکمیلی..."></textarea>
          </div>
        </div>
      </div>`;
  }

  openModal(modalTitle, `<div class="form-grid">${bodyHtml}</div>`, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveAddInstruction(${_pId||'null'},'${type === 'checklist' ? 'note' : type}')` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ], (type !== 'category' && type !== 'kcategory') ? { overlayClass: 'note-editor-modal' } : {});
  if (type !== 'category' && type !== 'kcategory') initDatePickers();
  // note-content-textarea نباید هیچ‌وقت auto-grow بگیرد (باعث jump کیبورد iOS می‌شد)؛
  // اگر به هر دلیلی data-autogrow-ready یا style.height از قبل روی این المان مانده،
  // اینجا پاکش می‌کنیم تا CSS اسکرول داخلی (height:100%) بدون تداخل اعمال شود.
  (function _stripAutoGrowFromNoteContent() {
    const ta = document.getElementById('instr-content');
    if (!ta) return;
    delete ta.dataset.autogrowReady;
    ta.style.height = '';
    ta.style.overflowY = '';
  })();
  setTimeout(() => {
    const first = document.querySelector('.icon-pick-btn');
    if (first) first.style.background = 'var(--accent2)33';
    const firstDot = document.querySelector('.color-pick-dot');
    if (firstDot) firstDot.style.outline = '3px solid var(--text)';
    document.getElementById('instr-title')?.focus();
    ['instr-content','instr-extra'].forEach(function(id) {
      const ta = document.getElementById(id);
      const fmap = {'instr-content':'content','instr-extra':'extra_note'};
      if (ta) ta.addEventListener('dblclick', function(){ _openFocusMode(ta, null, fmap[id]); });
    });
    if (isChecklist) {
      const ta = document.getElementById('instr-content');
      if (ta) { const pos = ta.value.indexOf('[ ] ') + 4; ta.selectionStart = ta.selectionEnd = pos >= 4 ? pos : 0; }
    }
  }, 50);
}

async function saveAddInstruction(parentId, type) {
  const title = document.getElementById('instr-title')?.value.trim();
  if (!title) { showToast('عنوان را وارد کنید', 'error'); return; }
  const staffCtx = _staffInstructionContext;
  const _parentId = (!parentId || parentId === 'null' || parentId === '') ? null : +parentId;
  if (!_teamCanCreateInstruction(_parentId)) { showToast('برای ذخیره در این پوشه دسترسی نداری', 'error'); return; }
  const icon = document.getElementById('instr-icon')?.value || '📝';
  const color = document.getElementById('instr-color')?.value || '#7c6af7';
  const content = document.getElementById('instr-content')?.value || '';
  const extra_note = document.getElementById('instr-extra')?.value || '';
  const importance = document.getElementById('instr-importance')?.value || 'normal';
  const date_jalali = document.getElementById('instr-date')?.value || '';
  const status = document.getElementById('instr-status')?.value || 'active';
  const tags = _parseTags(document.getElementById('instr-tags')?.value || '');
  const res = await window.api.instructions.add({
    parent_id: _parentId, title, icon, color, type: type||'note', content, extra_note, importance, date_jalali, status, tags,
    staff_id: staffCtx?.staffId || null,
    instruction_scope: staffCtx ? 'staff' : ''
  });
  if (res && res.ok === false) { showToast(res.error || 'ذخیره نشد', 'error'); return; }
  closeModal();
  showToast('ذخیره شد ✓', 'success');
  if (staffCtx) {
    _staffInstructionContext = null;
    _openStaffInstructions(staffCtx.staffId, _parentId);
    return;
  }
  renderInstructions();
}

function openEditInstruction(id) {
  const numId = +id;
  const node = (_db.instructions||[]).find(n => n.id === numId);
  if (!node) { showToast('مورد پیدا نشد','error'); return; }
  if (!_teamCanInstructionNode(numId)) { showToast('به این مورد دسترسی نداری', 'error'); return; }
  window._currentEditNoteId = numId;

  const iconBtns = INSTR_ICONS.map(i =>
    `<button type="button" onclick="document.getElementById('ei-icon').value='${i}';document.querySelectorAll('.icon-pick-btn2').forEach(b=>b.style.background='var(--bg3)');this.style.background='var(--accent2)33'" class="icon-pick-btn2" style="width:34px;height:34px;font-size:16px;border-radius:8px;border:1px solid var(--border2);background:${i===node.icon?'var(--accent2)33':'var(--bg3)'};cursor:pointer">${i}</button>`
  ).join('');
  const colorOpts = ['#7c6af7','#3ecf8e','#f87171','#60a5fa','#fbbf24','#f472b6','#34d399','#a78bfa','#fb923c','#06b6d4'].map(c =>
    `<div onclick="document.getElementById('ei-color').value='${c}';document.querySelectorAll('.color-pick-dot2').forEach(d=>d.style.outline='none');this.style.outline='3px solid var(--text)'" class="color-pick-dot2" style="width:22px;height:22px;border-radius:50%;background:${c};cursor:pointer;flex-shrink:0;outline:${c===node.color?'3px solid var(--text)':'none'}"></div>`
  ).join('');

  const iconColorBlock = `
    <div class="form-group full">
      <label class="form-label">آیکون</label>
      <input type="hidden" id="ei-icon" value="${escapeHtml(node.icon||'📝')}">
      <div style="display:flex;flex-wrap:wrap;gap:5px">${iconBtns}</div>
    </div>
    <div class="form-group full">
      <label class="form-label">رنگ</label>
      <input type="hidden" id="ei-color" value="${node.color||'#7c6af7'}">
      <div style="display:flex;gap:8px;flex-wrap:wrap">${colorOpts}</div>
    </div>`;

  let bodyHtml;
  if (node.type === 'category' || node.type === 'kcategory') {
    /* ── Categories/Folders: just 3 fields, nothing to hide ── */
    bodyHtml = `
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="ei-title" value="${escapeHtml(node.title)}">
      </div>
      ${iconColorBlock}`;
  } else {
    /* ── Notes: title + content up front; everything else behind a toggle ── */
    bodyHtml = `
      <div class="form-group full">
        <label class="form-label">عنوان</label>
        <input class="form-input" id="ei-title" value="${escapeHtml(node.title)}">
      </div>
      <div class="form-group full note-content-wrap">
        <label class="form-label">📄 محتوا</label>
        ${richToolbar('ei-content')}
        <textarea class="form-textarea note-content-textarea" id="ei-content" rows="6">${escapeHtml(_cleanupColorMarkers(node.content||''))}</textarea>
      </div>
      <div class="detail-section" style="margin:0 0 12px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
          <div><h3 style="margin:0">📎 پیوست‌ها</h3><div style="font-size:10px;color:var(--text3);margin-top:3px">فایل، تصویر یا سند مرتبط با این یادداشت</div></div>
          <button type="button" class="btn btn-ghost btn-sm" onclick="_triggerAttach('instruction',${id})">+ افزودن فایل</button>
        </div>
        ${(node.attachments||[]).length === 0
          ? '<p style="font-size:12px;color:var(--text3);margin:0">هنوز پیوستی اضافه نشده</p>'
          : renderAttachmentsGrid(node.attachments||[], `(fid)=>_deleteAttachment('instruction',${id},fid)`)}
      </div>
      <div class="form-group full">
        <button type="button" id="ei-adv-toggle" onclick="_toggleAdvanced('ei-advanced','ei-adv-toggle')"
          style="width:100%;text-align:center;padding:9px;border-radius:8px;border:1px dashed var(--border2);background:none;color:var(--text2);font-size:12px;font-family:var(--font);cursor:pointer">
          تنظیمات بیشتر (آیکون، رنگ، اهمیت، تاریخ، یادداشت تکمیلی) ▾
        </button>
      </div>
      <div id="ei-advanced" style="display:none" class="form-group full">
        <div class="form-grid">
          ${iconColorBlock}
          <div class="form-group">
            <label class="form-label">اهمیت</label>
            ${_impChipsHtml('ei-importance', node.importance==='key' ? 'key' : 'normal')}
          </div>
          <div class="form-group">
            <label class="form-label">وضعیت</label>
            <select class="form-input" id="ei-status">
              <option value="active" ${(node.status||'active')==='active'?'selected':''}>در حال انجام</option>
              <option value="done" ${node.status==='done'?'selected':''}>انجام شده</option>
              <option value="paused" ${node.status==='paused'?'selected':''}>متوقف</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">📅 تاریخ (شمسی)</label>
            <input class="form-input jdate" id="ei-date" value="${node.date_jalali||''}">
          </div>
          <div class="form-group full">
            <label class="form-label">🏷 برچسب‌ها</label>
            <input class="form-input" id="ei-tags" value="${escapeHtml((node.tags||[]).join('، '))}" placeholder="مثلاً: UI، UX، مهم، در حال انجام">
          </div>
          <div class="form-group full">
            <label class="form-label">📝 یادداشت تکمیلی</label>
            ${richToolbar('ei-extra')}
            <textarea class="form-textarea" id="ei-extra" rows="3">${escapeHtml(_cleanupColorMarkers(node.extra_note||''))}</textarea>
          </div>
        </div>
      </div>`;
  }

  openModal(`✏️ ویرایش — ${escapeHtml(node.title)}`, `<div class="form-grid">${bodyHtml}</div>`, [
    { label: 'ذخیره', cls: 'btn-primary', action: `saveEditInstruction(${id},${escapeAttr(node.type)})` },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ], node.type === 'note' ? { overlayClass: 'note-editor-modal' } : {});
  if (node.type === 'note') {
    initDatePickers();
    // پاک‌سازی دفاعی auto-grow برای textarea محتوای یادداشت (رجوع به توضیح مشابه در openAddInstruction)
    (function _stripAutoGrowFromNoteContent() {
      const ta = document.getElementById('ei-content');
      if (!ta) return;
      delete ta.dataset.autogrowReady;
      ta.style.height = '';
      ta.style.overflowY = '';
    })();
    setTimeout(function() {
      ['ei-content','ei-extra'].forEach(function(fid) {
        const ta = document.getElementById(fid);
        const fmap2 = {'ei-content':'content','ei-extra':'extra_note'};
        if (ta) ta.addEventListener('dblclick', function(){ _openFocusMode(ta, numId, fmap2[fid]); });
      });
    }, 80);
  }
}

async function saveEditInstruction(id, type) {
  if (!_teamCanInstructionNode(id)) { showToast('به این مورد دسترسی نداری', 'error'); return; }
  const existingNode = (_db.instructions || []).find(n => +n.id === +id);
  const title = document.getElementById('ei-title')?.value.trim();
  if (!title) { showToast('عنوان را وارد کنید','error'); return; }
  const res = await window.api.instructions.update({
    id, title,
    icon: document.getElementById('ei-icon')?.value,
    color: document.getElementById('ei-color')?.value,
    content: document.getElementById('ei-content')?.value || '',
    extra_note: document.getElementById('ei-extra')?.value || '',
    importance: document.getElementById('ei-importance')?.value || 'normal',
    date_jalali: document.getElementById('ei-date')?.value || '',
    status: document.getElementById('ei-status')?.value || 'active',
    tags: _parseTags(document.getElementById('ei-tags')?.value || ''),
  });
  if (res && res.ok === false) { showToast(res.error || 'ذخیره نشد', 'error'); return; }
  closeModal();
  showToast('ذخیره شد ✓','success');
  if (existingNode?.staff_id) {
    _openStaffInstructions(existingNode.staff_id, existingNode.parent_id || null);
    return;
  }
  renderInstructions();
}

async function deleteInstruction(id) {
  const node = (_db.instructions||[]).find(n => n.id === +id);
  if (!_teamCanInstructionNode(id)) { showToast('به این مورد دسترسی نداری', 'error'); return; }
  const name = node ? escapeHtml(node.title) : 'این مورد';
  const isFolder = node && (node.type === 'category' || node.type === 'kcategory');
  const childCount = isFolder ? (_db.instructions||[]).filter(x => x.parent_id && +x.parent_id === +id).length : 0;
  const warnText = isFolder && childCount > 0
    ? `<div style="color:var(--red);background:rgba(248,113,113,.1);border-radius:8px;padding:10px 14px;margin-top:10px;font-size:13px">⚠️ این پوشه دارای ${fa(childCount)} مورد زیرشاخه است که همه حذف خواهند شد.</div>`
    : '';
  openModal('⚠️ تأیید حذف', `
    <div style="text-align:center;padding:10px 0">
      <div style="font-size:36px;margin-bottom:12px">🗑️</div>
      <p style="font-size:14px;color:var(--text);margin-bottom:8px">آیا از حذف <strong>${name}</strong> مطمئن هستید؟</p>
      ${warnText}
      <p style="font-size:12px;color:var(--text3);margin-top:10px">این عملیات قابل بازگشت نیست.</p>
    </div>
  `, [
    { label: '🗑️ بله، حذف شود', cls: 'btn-primary" style="background:var(--red);border-color:var(--red)', action: '_confirmDeleteInstruction(' + id + ')' },
    { label: 'انصراف', cls: 'btn-ghost', action: 'closeModal()' },
  ]);
}

async function _confirmDeleteInstruction(id) {
  if (!_teamCanInstructionNode(id)) { showToast('به این مورد دسترسی نداری', 'error'); return; }
  const nodeBeforeDelete = (_db.instructions || []).find(n => +n.id === +id);
  closeModal();
  if (window.api && window.api.instructions) {
    const res = await window.api.instructions.delete(id);
    if (res && res.ok === false) { showToast(res.error || 'حذف نشد', 'error'); return; }
  } else {
    const ds=new Set(); function dc(x){ds.add(x);(_db.instructions||[]).filter(n=>n.parent_id==x).forEach(n=>dc(n.id));} dc(id);
    _db.instructions=(_db.instructions||[]).filter(n=>!ds.has(n.id)); _forceNextServerSync(); _save();
  }
  clearTimeout(window._serverSyncTimer);
  _syncToServer();
  showToast('حذف شد','error');
  if (nodeBeforeDelete?.staff_id) {
    _openStaffInstructions(nodeBeforeDelete.staff_id, nodeBeforeDelete.parent_id || null);
    return;
  }
  renderInstructions();
}

// ════════════════════════════════════════════════════════════════════════════
// TUTORIAL PAGE — آموزش‌ها
// ════════════════════════════════════════════════════════════════════════════
async function renderTutorial() {
  updateTopbarActions('');
  const sections = [
    { icon:'👥', title:'شاگردان', color:'#7c6af7',
      desc:'مرکز اصلی برنامه. هر شاگرد پروفایل کاملی داره شامل اطلاعات تماس، پکیج‌های خریداری‌شده، تاریخچه پرداخت و جلسات.',
      tips:['برای افزودن شاگرد جدید دکمه + رو بزن','می‌تونی چند پکیج مختلف برای یه شاگرد تعریف کنی','کیف پول برای مدیریت اعتبار استفاده میشه'] },
    { icon:'📅', title:'جلسات', color:'#3ecf8e',
      desc:'تمام جلسات کوچینگ رو ثبت کن. می‌تونی یادداشت، فایل پیوست و علامت‌گذاری مهم داشته باشی.',
      tips:['جلسات مهم رو ستاره‌دار کن','می‌تونی فایل و عکس به هر جلسه ضمیمه کنی','توضیح اضافه برای یادداشت‌های خصوصی'] },
    { icon:'🛒', title:'پرداخت‌ها', color:'#60a5fa',
      desc:'تاریخچه کامل خریدها و پرداخت‌ها. بدهی‌ها رو دنبال کن و گزارش مالی بگیر.',
      tips:['ارزهای مختلف پشتیبانی میشه','از داشبورد مالی گزارش کامل ببین'] },
    { icon:'⏰', title:'یادآوری‌ها', color:'#fbbf24',
      desc:'سیستم یادآوری هوشمند برای تمدید پکیج‌ها. وقتی پکیج یه شاگرد تموم میشه بهت یادآوری می‌کنه.',
      tips:['یادآوری‌های تکرارشونده ماهانه داری','می‌تونی مستقیم از یادآوری پرداخت ثبت کنی'] },
    { icon:'✅', title:'لیست کارها', color:'#34d399',
      desc:'Todo list حرفه‌ای با امکان تکرار روزانه، هفتگی، ماهانه و یادآوری. کارهای انجام‌شده با صدا تأیید میشن.',
      tips:['کارهای تکراری رو یه بار تنظیم کن','یادآوری قبل از وقت کار رو فعال کن','کارهای انجام‌شده بعد از چند ساعت به بایگانی میرن'] },
    { icon:'💡', title:'مرکز دانش', color:'#fbbf24',
      desc:'یه پایگاه دانش شخصی. پوشه‌بندی تودرتو، یادداشت با محتوای کامل، آیکون و رنگ سفارشی.',
      tips:['می‌تونی پوشه داخل پوشه بسازی','فایل و عکس به یادداشت‌ها ضمیمه کن'] },
    { icon:'🧑‍💼', title:'مدیریت', color:'#fb923c',
      desc:'حقوق، نقش‌ها، پرداخت‌های ماهانه و یادآوری پرداخت پرسنل و اعضا رو مدیریت کن.',
      tips:['هر پرسنل می‌تونه چند نقش با دستمزد مجزا داشته باشه','اعضا برای پرداخت‌های غیرپرسنلی مثل اجاره مناسب‌اند'] },
    { icon:'📊', title:'داشبورد مالی', color:'#f472b6',
      desc:'نمای کلی از وضعیت مالی: درآمد ماهانه، بدهکاران، بهترین مشتریان و نمودار درآمد.',
      tips:['نمودار درآمد رو با فیلتر سال ببین','لیست بدهکاران رو برای پیگیری استفاده کن'] },
    { icon:'⚙️', title:'تنظیمات', color:'#9399ab',
      desc:'برچسب‌ها، نوع پکیج‌ها، بازیابی نسخه‌های قبلی و پشتیبان‌گیری.',
      tips:['اول برو تنظیمات و برچسب‌ها رو سفارشی کن','پشتیبان‌گیری منظم انجام بده'] },
  ];

  const adminSettings = JSON.parse(localStorage.getItem('tp_admin_settings') || '{}');
  const videoUrl = adminSettings.tutorial_video_url || '';
  // تبدیل لینک یوتیوب به embed
  function _getYoutubeEmbedUrl(url) {
    if (!url) return '';
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
    return m ? 'https://www.youtube.com/embed/' + m[1] : '';
  }
  const embedUrl = _getYoutubeEmbedUrl(videoUrl);

  const videoSection = videoUrl ? `
    <div style="margin-bottom:20px;background:var(--bg2);border:1px solid var(--border2);border-radius:16px;overflow:hidden">
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px">
        🎬 <span>ویدیو آموزشی</span>
      </div>
      <div style="padding:16px">
        ${embedUrl ? `
        <div style="position:relative;padding-bottom:56.25%;height:0;border-radius:12px;overflow:hidden;background:#000">
          <iframe src="${embedUrl}" frameborder="0" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen
            style="position:absolute;top:0;left:0;width:100%;height:100%;border-radius:12px"></iframe>
        </div>` : `
        <a href="${videoUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:8px;text-decoration:none">
          ▶️ مشاهده ویدیو آموزشی
        </a>`}
      </div>
    </div>` : '';

  const html = `
    ${videoSection}
    <div style="margin-bottom:20px;padding:16px;background:linear-gradient(135deg,rgba(124,106,247,.1),rgba(62,207,142,.1));border:1px solid var(--border2);border-radius:14px">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 6px">🎓 راهنمای کامل TeamPulse</h2>
      <p style="font-size:13px;color:var(--text2);margin:0">در این بخش همه قابلیت‌های برنامه توضیح داده شده.</p>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px">
      ${sections.map(s => `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden">
        <div style="display:flex;align-items:center;gap:12px;padding:14px;cursor:pointer;user-select:none"
          onclick="this.parentElement.querySelector('.tut-body').style.display=this.parentElement.querySelector('.tut-body').style.display==='none'?'block':'none'">
          <div style="width:38px;height:38px;border-radius:10px;background:${s.color}22;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">${escapeHtml(s.icon)}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:14px;color:var(--text)">${escapeHtml(s.title)}</div>
            <div style="font-size:12px;color:var(--text3)">${s.desc.slice(0,60)}...</div>
          </div>
          <span style="color:var(--text3);font-size:12px">▾</span>
        </div>
        <div class="tut-body" style="display:none;padding:0 14px 14px;border-top:1px solid var(--border)">
          <p style="font-size:13px;color:var(--text2);margin:12px 0 8px;line-height:1.7">${s.desc}</p>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${s.tips.map(tip => `
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text3)">
              <span style="color:${s.color}">●</span> ${tip}
            </div>`).join('')}
          </div>
        </div>
      </div>`).join('')}
    </div>`;

  // فقط ادمین واقعی (نه impersonating) بخش مدیریت ویدیو رو می‌بینه
  const isAdmin = _auth.isAdmin() && !window._impersonating;

  const adminVideoSection = isAdmin ? `
    <div style="margin-top:16px;background:var(--bg2);border:1px solid var(--amber);border-radius:14px;padding:16px">
      <h3 style="font-size:13px;font-weight:700;margin-bottom:10px">👑 تنظیمات مدیر — ویدیو آموزشی</h3>
      <p style="font-size:12px;color:var(--text3);margin-bottom:10px">لینک ویدیو آموزشی رو وارد کن تا برای همه کاربران نمایش داده بشه:</p>
      <div style="display:flex;gap:8px">
        <input class="form-input" id="admin-video-url" placeholder="https://youtube.com/..." value="${videoUrl}" style="flex:1">
        <button class="btn btn-primary" onclick="_saveAdminVideoUrl()">💾 ذخیره</button>
      </div>
    </div>` : '';

  const stepByStep = `
    <div style="margin-top:16px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-size:14px;font-weight:700">📖 دستورالعمل گام‌به‌گام استفاده از برنامه</div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
        ${[
          {n:'۱', title:'ثبت‌نام و ورود', desc:'ابتدا با ایمیل خود ثبت‌نام کنید. بعد از ورود، اطلاعات اولیه کسب‌وکار خود را وارد کنید.'},
          {n:'۲', title:'تعریف نوع پکیج', desc:'از منوی تنظیمات، انواع پکیج‌هایی که ارائه می‌دهید را تعریف کنید (مثلاً: کوچینگ، مشاوره).'},
          {n:'۳', title:'افزودن اولین شاگرد', desc:'از بخش شاگردان، روی دکمه + کلیک کنید. نام، شماره تماس و پکیج را وارد کنید.'},
          {n:'۴', title:'ثبت جلسات', desc:'بعد از هر جلسه، از بخش جلسات روی نام شاگرد کلیک کنید و جلسه جدید ثبت کنید.'},
          {n:'۵', title:'پیگیری پرداخت‌ها', desc:'از بخش یادآوری‌ها، سررسید پرداخت‌ها را دنبال کنید و بعد از پرداخت تأیید کنید.'},
          {n:'۶', title:'لیست کارها', desc:'کارهای روزانه و هفتگی خود را در لیست کارها ثبت کنید و تکرار زمان‌بندی‌شده تنظیم کنید.'},
          {n:'۷', title:'پشتیبان‌گیری', desc:'هفتگی از تنظیمات > پشتیبان‌گیری فایل پشتیبان تهیه کنید.'},
        ].map(s => `
          <div style="display:flex;gap:12px;align-items:flex-start">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--accent2);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0">${s.n}</div>
            <div>
              <div style="font-weight:700;font-size:13px;margin-bottom:2px">${escapeHtml(s.title)}</div>
              <div style="font-size:12px;color:var(--text2);line-height:1.7">${s.desc}</div>
            </div>
          </div>`).join('')}
      </div>
    </div>`;

  setContent(html + stepByStep + adminVideoSection);
}

function _saveAdminVideoUrl() {
  const url = document.getElementById('admin-video-url')?.value.trim();
  const settings = JSON.parse(localStorage.getItem('tp_admin_settings') || '{}');
  settings.tutorial_video_url = url;
  localStorage.setItem('tp_admin_settings', JSON.stringify(settings));
  showToast('لینک ویدیو ذخیره شد ✓', 'success');
  renderTutorial();
}

