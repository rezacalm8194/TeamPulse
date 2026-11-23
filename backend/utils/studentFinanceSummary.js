// Mirrors _studentListSummary debt logic from app.js (push / archive reminders).

const ALL_CURRENCIES = ['تومان', 'درهم', 'دلار', 'یورو'];
const APP_TIME_ZONE = 'Asia/Tehran';

function div(a, b) { return Math.floor(a / b); }
function mod(a, b) { return a - div(a, b) * b; }

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = (gy <= 1600) ? 0 : 979;
  gy -= (gy <= 1600) ? 621 : 1600;
  const gy2 = (gm > 2) ? (gy + 1) : gy;
  let days = (365 * gy) + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + g_d_m[gm - 1];
  jy += 33 * div(days, 12053);
  days = mod(days, 12053);
  jy += 4 * div(days, 1461);
  days = mod(days, 1461);
  if (days > 365) { jy += div(days - 1, 365); days = mod(days - 1, 365); }
  const jm = (days < 186) ? 1 + div(days, 31) : 7 + div(days - 186, 30);
  const jd = 1 + ((days < 186) ? mod(days, 31) : mod(days - 186, 30));
  return [jy, jm, jd];
}

function timeZoneParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const out = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  });
  return { year: out.year, month: out.month, day: out.day };
}

function todayJalaliKey(now = new Date()) {
  const { year, month, day } = timeZoneParts(now);
  const [jy, jm, jd] = gregorianToJalali(year, month, day);
  return jy * 10000 + jm * 100 + jd;
}

function jalaliParse(str) {
  const norm = String(str).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d]/g, '/').replace(/\/+/g, '/');
  return norm.split('/').map((x) => parseInt(x, 10));
}

function jalaliKey(str) {
  if (!str) return 0;
  const p = jalaliParse(str);
  if (p.length !== 3 || p.some(Number.isNaN)) return 0;
  return p[0] * 10000 + p[1] * 100 + p[2];
}

function moneyCurrency(v) {
  const s = String(v || '').trim();
  return ALL_CURRENCIES.includes(s) ? s : 'تومان';
}

function isTomanCurrency(v) {
  return moneyCurrency(v) === 'تومان';
}

function packagePaymentDueDate(pkg) {
  return String(pkg?.payment_due_date || pkg?.first_payment_due_date || pkg?.due_date_jalali || '').trim();
}

function packageDefersUntilDue(pkg) {
  return pkg?.defer_until_due === true || pkg?.defer_until_due === 1 || pkg?.defer_until_due === '1';
}

function packageChargeDate(pkg) {
  return String(pkg?.charge_date || packagePaymentDueDate(pkg) || '').trim();
}

function isPackageChargeable(pkg, now = new Date()) {
  if (!packageDefersUntilDue(pkg)) return true;
  const date = packageChargeDate(pkg);
  if (!date) return false;
  const dueKey = jalaliKey(date);
  if (!dueKey) return false;
  return dueKey <= todayJalaliKey(now);
}

function fxBooksFrom(packages, payments) {
  const books = new Map();
  const bump = (currency, field, amount) => {
    const cur = moneyCurrency(currency);
    if (cur === 'تومان') return;
    const n = Number(amount) || 0;
    if (!n && field !== 'contract') return;
    const row = books.get(cur) || { currency: cur, contract: 0, paid: 0 };
    row[field] += n;
    books.set(cur, row);
  };
  (packages || []).forEach((p) => {
    // Same as app _studentListSummary: mapped rows omit defer fields, so
    // _isPackageChargeable here only sees chargeable state via is_chargeable-less map.
    // Call isPackageChargeable on objects that match mapped summary shape (no defer).
    if (!isPackageChargeable(p)) return;
    bump(p.currency, 'contract', (Number(p.total_amount) || 0) + (Number(p.initial_cost) || 0));
  });
  (payments || []).forEach((p) => bump(p.currency, 'paid', p.amount));
  return [...books.values()]
    .map((b) => ({ ...b, balance: b.contract - b.paid }))
    .filter((b) => b.contract || b.paid);
}

function studentListSummaryDebt(student, packages, payments, now = new Date()) {
  const sid = String(student?.id ?? '');
  if (!sid) return { balance: 0, fxBooks: [], hasDebt: false };
  const studentPackages = (packages || []).filter((p) => String(p.student_id) === sid);
  const studentPayments = (payments || []).filter((p) => String(p.student_id) === sid);

  const mapped = studentPackages.map((p) => {
    const grandTotal = (Number(p.total_amount) || 0) + (Number(p.initial_cost) || 0);
    const chargeable = isPackageChargeable(p, now);
    return {
      id: p.id,
      currency: moneyCurrency(p.currency),
      total_amount: Number(p.total_amount) || 0,
      initial_cost: Number(p.initial_cost) || 0,
      grand_total: grandTotal,
      due_total: chargeable && isTomanCurrency(p.currency) ? grandTotal : 0,
      is_chargeable: chargeable,
    };
  });

  let totalPaid = 0;
  for (const p of studentPayments) {
    if (isTomanCurrency(p.currency)) totalPaid += Number(p.amount) || 0;
  }
  const totalAmount = mapped.reduce((a, pkg) => a + pkg.due_total, 0);
  const wallet = Number(student.wallet) || 0;
  const balance = totalAmount - totalPaid - wallet;
  const fxBooks = fxBooksFrom(mapped, studentPayments);
  const hasFxDebt = fxBooks.some((b) => Number(b.balance) !== 0);
  return {
    balance,
    fxBooks,
    hasDebt: balance !== 0 || hasFxDebt,
  };
}

function studentHasFinanceDebt(userData, studentId, options = {}) {
  const student = (userData?.students || []).find((s) => String(s.id) === String(studentId ?? ''));
  if (!student) return false;
  const now = options.now || new Date();
  return studentListSummaryDebt(
    student,
    userData?.packages,
    userData?.payments,
    now,
  ).hasDebt;
}

module.exports = {
  studentHasFinanceDebt,
  studentListSummaryDebt,
  isPackageChargeable,
  isTomanCurrency,
  moneyCurrency,
  jalaliKey,
  todayJalaliKey,
  fxBooksFrom,
  APP_TIME_ZONE,
};