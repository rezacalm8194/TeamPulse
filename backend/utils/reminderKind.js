function isPaymentReminder(r) {
  if (!r) return false;
  const source = String(r.source || '');
  if (source === 'session_followup' || source === 'auto_stale_lead' || source === 'archive_followup') return false;
  const title = String(r.title || '').trim();
  return !(title.startsWith('اقدام جلسه') || title.startsWith('پیگیری بایگانی:') || title.startsWith('پیگیری راکد'));
}

function isPackageRenewalReminder(r) {
  if (!r || !isPaymentReminder(r)) return false;
  const title = String(r.title || '').trim();
  if (/^سررسید\s*پرداخت\s*[:：]/.test(title)) return false;
  return /^(تجدید|تمدید)\s*پکیج/i.test(title);
}

const { studentHasFinanceDebt } = require('./studentFinanceSummary');

function reminderPausedByArchive(r, userData) {
  const student = (userData?.students || []).find(s => String(s.id) === String(r?.student_id ?? ''));
  if (!student?.archived) return false;
  if (!studentHasFinanceDebt(userData, r.student_id)) return true;
  return isPackageRenewalReminder(r);
}

module.exports = {
  isPaymentReminder,
  isPackageRenewalReminder,
  studentHasFinanceDebt,
  reminderPausedByArchive,
};