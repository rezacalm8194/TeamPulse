function isPaymentReminder(r) {
  if (!r) return false;
  const source = String(r.source || '');
  if (source === 'session_followup' || source === 'auto_stale_lead' || source === 'archive_followup') return false;
  const title = String(r.title || '').trim();
  return !(title.startsWith('اقدام جلسه') || title.startsWith('پیگیری بایگانی:') || title.startsWith('پیگیری راکد'));
}

module.exports = { isPaymentReminder };
