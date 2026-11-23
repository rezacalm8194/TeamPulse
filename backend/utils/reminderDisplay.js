const RENEWAL_HEAD_RE = /^(?:تجدید\s*پکیج|تمدید\s*پکیج)\s*[:：]\s*/i;

function stripPkgRenewalTitleHead(title) {
  let core = String(title ?? '').trim();
  let prev = '';
  while (core && core !== prev) {
    prev = core;
    core = core.replace(RENEWAL_HEAD_RE, '').trim();
  }
  return core;
}

function joinPkgRenewalReminderTitle(baseTitle) {
  const core = stripPkgRenewalTitleHead(baseTitle);
  return core ? `تجدید پکیج: ${core}` : 'تجدید پکیج';
}

function displayReminderTitle(title) {
  const raw = String(title ?? '');
  if (!RENEWAL_HEAD_RE.test(raw)) return raw;
  return joinPkgRenewalReminderTitle(raw);
}

module.exports = {
  displayReminderTitle,
  joinPkgRenewalReminderTitle,
  stripPkgRenewalTitleHead,
};