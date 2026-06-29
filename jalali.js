// ── Minimal Gregorian <-> Jalali (Persian) calendar conversion ────────────────
// Standard algorithm (public domain math), independent implementation.

function div(a, b) { return Math.floor(a / b); }
function mod(a, b) { return a - div(a, b) * b; }

function gregorianToJalali(gy, gm, gd) {
  const g_d_m = [0,31,59,90,120,151,181,212,243,273,304,334];
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

function jalaliToGregorian(jy, jm, jd) {
  let gy = (jy <= 979) ? 621 : 1600;
  jy -= (jy <= 979) ? 0 : 979;
  let days = (365 * jy) + (div(jy, 33) * 8) + div(mod(jy, 33) + 3, 4) + 78 + jd
    + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
  gy += 400 * div(days, 146097);
  days = mod(days, 146097);
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days = mod(days, 36524);
    if (days >= 365) days++;
  }
  gy += 4 * div(days, 1461);
  days = mod(days, 1461);
  gy += div(days - 1, 365);
  if (days > 365) days = mod(days - 1, 365);
  let gd = days + 1;
  const sal_a = [0,31, ((gy%4===0 && gy%100!==0)||gy%400===0) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31];
  let gm = 0;
  for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
  return [gy, gm, gd];
}

function jMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  // month 12 (اسفند)
  const g = jalaliToGregorian(jy, 1, 1);
  const nextG = jalaliToGregorian(jy+1, 1, 1);
  // days in this jalali year:
  const d1 = g2dCount(g[0],g[1],g[2]);
  const d2 = g2dCount(nextG[0],nextG[1],nextG[2]);
  return (d2 - d1) - 336;
}
function g2dCount(gy,gm,gd){
  const d = new Date(Date.UTC(gy, gm-1, gd));
  return Math.floor(d.getTime()/86400000);
}

const JMONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const JWEEKDAYS = ['ش','ی','د','س','چ','پ','ج']; // starting Saturday

function todayJalali() {
  const now = new Date();
  return gregorianToJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
}

function addJalaliMonths(jy, jm, jd, months) {
  let totalMonths = (jy*12 + (jm-1)) + months;
  const newJy = Math.floor(totalMonths/12);
  const newJm = (totalMonths % 12) + 1;
  const maxDay = jMonthLength(newJy, newJm);
  return [newJy, newJm, Math.min(jd, maxDay)];
}

function jalaliKey(str) {
  const p = parseJalali(str);
  if (!p) return 0;
  return p[0]*10000 + p[1]*100 + p[2];
}

function faDigits(n) { return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]); }
function enDigits(s) { return String(s).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }

function formatJalali(jy, jm, jd) {
  return `${faDigits(jy)}/${faDigits(String(jm).padStart(2,'0'))}/${faDigits(String(jd).padStart(2,'0'))}`;
}

// Parse a jalali string like ۱۴۰۴/۰۳/۲۰ or 1404/03/20
function parseJalali(str) {
  if (!str) return null;
  const norm = enDigits(str.trim()).replace(/[^\d]/g, '/').replace(/\/+/g, '/');
  const parts = norm.split('/').map(x => parseInt(x, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  return parts;
}

// ── Date picker widget ─────────────────────────────────────────────────────
let activeDatePicker = null;
let activeDpCloseHandler = null;

function closeDatePicker() {
  if (activeDpCloseHandler) {
    document.removeEventListener('click', activeDpCloseHandler);
    activeDpCloseHandler = null;
  }
  if (activeDatePicker) { activeDatePicker.remove(); activeDatePicker = null; }
}

function attachJalaliDatePicker(input) {
  if (!input || input._dpAttached) return;
  input._dpAttached = true;

  const wrap = document.createElement('div');
  wrap.className = 'jdate-wrap';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jdate-btn';
  btn.title = 'انتخاب از تقویم';
  btn.textContent = '📅';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDatePicker(input);
  });
  wrap.appendChild(btn);
}

function openDatePicker(input) {
  closeDatePicker();
  let [jy, jm, jd] = parseJalali(input.value) || todayJalali();

  const pop = document.createElement('div');
  pop.className = 'jdate-popup';

  function render() {
    const monthLen = jMonthLength(jy, jm);
    // figure weekday of first day of month
    const g = jalaliToGregorian(jy, jm, 1);
    const dow = new Date(g[0], g[1]-1, g[2]).getDay(); // 0=Sunday..6=Saturday
    // convert to Saturday-start index: Saturday=0
    const startIdx = (dow + 1) % 7;

    let cells = '';
    for (let i = 0; i < startIdx; i++) cells += `<div class="jd-cell jd-empty"></div>`;
    for (let d = 1; d <= monthLen; d++) {
      const isToday = (() => { const t = todayJalali(); return t[0]===jy && t[1]===jm && t[2]===d; })();
      cells += `<div class="jd-cell${isToday?' jd-today':''}" data-d="${d}">${faDigits(d)}</div>`;
    }

    pop.innerHTML = `
      <div class="jd-header">
        <button class="jd-nav" data-act="prev">‹</button>
        <span class="jd-title">${JMONTHS[jm-1]} ${faDigits(jy)}</span>
        <button class="jd-nav" data-act="next">›</button>
      </div>
      <div class="jd-weekdays">${JWEEKDAYS.map(w=>`<div class="jd-wd">${w}</div>`).join('')}</div>
      <div class="jd-grid">${cells}</div>
      <div class="jd-footer">
        <button class="jd-today-btn" data-act="today">امروز</button>
      </div>
    `;

    pop.querySelector('[data-act="prev"]').onclick = (e) => { e.stopPropagation(); jm--; if (jm<1){jm=12;jy--;} render(); };
    pop.querySelector('[data-act="next"]').onclick = (e) => { e.stopPropagation(); jm++; if (jm>12){jm=1;jy++;} render(); };
    pop.querySelector('[data-act="today"]').onclick = (e) => {
      e.stopPropagation();
      const t = todayJalali(); jy=t[0]; jm=t[1]; jd=t[2];
      input.value = formatJalali(jy,jm,jd);
      closeDatePicker();
    };
    pop.querySelectorAll('.jd-cell[data-d]').forEach(cell => {
      cell.onclick = (e) => {
        e.stopPropagation();
        const d = +cell.dataset.d;
        input.value = formatJalali(jy, jm, d);
        closeDatePicker();
      };
    });
  }
  render();

  document.body.appendChild(pop);
  const rect = input.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.top = (rect.bottom + 4) + 'px';
  pop.style.left = Math.max(8, rect.left) + 'px';
  pop.style.zIndex = 999;
  activeDatePicker = pop;

  setTimeout(() => {
    activeDpCloseHandler = closeDatePickerOnce;
    document.addEventListener('click', activeDpCloseHandler);
  }, 0);
}

function closeDatePickerOnce(e) {
  if (activeDatePicker && !activeDatePicker.contains(e.target)) closeDatePicker();
}

// ── Persian number to words (for amount hints) ───────────────────────────────
const PW_ONES = ['','یک','دو','سه','چهار','پنج','شش','هفت','هشت','نه'];
const PW_TEENS = ['ده','یازده','دوازده','سیزده','چهارده','پانزده','شانزده','هفده','هجده','نوزده'];
const PW_TENS = ['','ده','بیست','سی','چهل','پنجاه','شصت','هفتاد','هشتاد','نود'];
const PW_HUNDREDS = ['','صد','دویست','سیصد','چهارصد','پانصد','ششصد','هفتصد','هشتصد','نهصد'];
const PW_SCALES = ['','هزار','میلیون','میلیارد','تریلیون'];

function threeDigitsToWords(n) {
  const parts = [];
  const h = Math.floor(n/100), t = Math.floor((n%100)/10), o = n%10;
  if (h) parts.push(PW_HUNDREDS[h]);
  if (t === 1) parts.push(PW_TEENS[o]);
  else {
    if (t) parts.push(PW_TENS[t]);
    if (o) parts.push(PW_ONES[o]);
  }
  return parts.join(' و ');
}

function numberToPersianWords(num) {
  num = Math.floor(Math.abs(num));
  if (num === 0) return 'صفر';
  const groups = [];
  while (num > 0) { groups.unshift(num % 1000); num = Math.floor(num/1000); }
  const parts = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const scaleIdx = groups.length - 1 - i;
    const words = threeDigitsToWords(g);
    parts.push(scaleIdx > 0 ? `${words} ${PW_SCALES[scaleIdx]}` : words);
  });
  return parts.join(' و ');
}

const JWEEKDAY_FULL = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه','شنبه'];
function jalaliWeekdayName(dateStr) {
  const p = parseJalali(dateStr);
  if (!p) return '';
  const [jy,jm,jd] = p;
  const [gy,gm,gd] = jalaliToGregorian(jy,jm,jd);
  const dow = new Date(gy, gm-1, gd).getDay(); // 0=Sunday
  return JWEEKDAY_FULL[dow] || '';
}

const JWEEKDAY_NAMES = ['یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه','شنبه'];

function jalaliWeekdayName(dateStr) {
  const p = parseJalali(dateStr);
  if (!p) return '';
  const [gy,gm,gd] = jalaliToGregorian(p[0], p[1], p[2]);
  const dow = new Date(gy, gm-1, gd).getDay(); // 0=Sun..6=Sat
  return JWEEKDAY_NAMES[dow];
}
