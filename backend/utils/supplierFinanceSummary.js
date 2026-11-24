const { partyRoles } = require('./partyRoles');
const { moneyCurrency, isTomanCurrency } = require('./studentFinanceSummary');

function purchaseTotal(row) {
  const items = Array.isArray(row?.items) ? row.items : [];
  const fromItems = items.reduce((sum, it) => {
    const q = Number(it?.qty) || 0;
    const p = Number(it?.unit_price) || 0;
    return sum + q * p;
  }, 0);
  const manual = Number(row?.total_amount) || 0;
  return fromItems > 0 ? fromItems : manual;
}

function fxBooksFromPurchases(purchases, payments) {
  const books = new Map();
  const bump = (currency, field, amount) => {
    const cur = moneyCurrency(currency);
    if (cur === 'تومان') return;
    const n = Number(amount) || 0;
    if (!n) return;
    const row = books.get(cur) || { currency: cur, contract: 0, paid: 0 };
    row[field] += n;
    books.set(cur, row);
  };
  (purchases || []).forEach((p) => bump(p.currency, 'contract', purchaseTotal(p)));
  (payments || []).forEach((p) => bump(p.currency, 'paid', p.amount));
  return [...books.values()]
    .map((b) => ({ ...b, balance: b.contract - b.paid }))
    .filter((b) => b.contract || b.paid);
}

function supplierListSummaryDebt(supplierId, purchases, expenses, options = {}) {
  const sid = String(supplierId ?? '');
  if (!sid) return { balance: 0, fxBooks: [], hasDebt: false };

  const supplierPurchases = (purchases || []).filter((p) => String(p.supplier_id) === sid);
  const supplierPayments = (expenses || []).filter(
    (e) => e?.source === 'supplier_payment' && String(e.supplier_id) === sid,
  );

  let purchaseToman = 0;
  let paidToman = 0;
  supplierPurchases.forEach((p) => {
    if (isTomanCurrency(p.currency)) purchaseToman += purchaseTotal(p);
  });
  supplierPayments.forEach((e) => {
    paidToman += Number(e.amount) || 0;
  });

  const balance = purchaseToman - paidToman;
  const fxBooks = fxBooksFromPurchases(supplierPurchases, supplierPayments);
  const hasFxDebt = fxBooks.some((b) => Number(b.balance) !== 0);
  return {
    balance,
    fxBooks,
    hasDebt: balance !== 0 || hasFxDebt,
    purchaseToman,
    paidToman,
  };
}

function supplierHasDebt(userData, supplierId) {
  const student = (userData?.students || []).find((s) => String(s.id) === String(supplierId ?? ''));
  if (!student) return false;
  const roles = partyRoles(student);
  if (!roles.is_supplier) return false;
  return supplierListSummaryDebt(
    supplierId,
    userData?.purchases,
    userData?.expenses,
  ).hasDebt;
}

module.exports = {
  partyRoles,
  purchaseTotal,
  fxBooksFromPurchases,
  supplierListSummaryDebt,
  supplierHasDebt,
};