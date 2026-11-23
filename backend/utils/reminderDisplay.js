const RENEWAL_CHUNK_RE = /^(تجدید|تمدید)\s*پکیج\s*[:：]\s*/i;

function dedupePkgRenewalTitle(title) {
  const raw = String(title ?? '');
  let rest = raw;
  let firstWord = '';
  let count = 0;
  for (;;) {
    const m = rest.match(RENEWAL_CHUNK_RE);
    if (!m) break;
    count++;
    if (!firstWord) firstWord = m[1];
    rest = rest.slice(m[0].length).trim();
  }
  if (count <= 1) return raw;
  return `${firstWord} پکیج: ${rest}`;
}

function displayReminderTitle(title) {
  return dedupePkgRenewalTitle(title);
}

module.exports = {
  displayReminderTitle,
  dedupePkgRenewalTitle,
};