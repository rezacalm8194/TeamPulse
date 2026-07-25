// backend/scripts/fix-misplaced-todos.js
//
// مشکلی که رفع می‌کنه:
// یک باگ قدیمی (احتمالاً موقع impersonate/کش) باعث شده بود تسک‌های بعضی
// کاربرها به‌جای حساب خودشون، توی داده‌ی حساب یک کاربر دیگه (مثلاً ادمین)
// ذخیره بشه. فیلتر سمت کلاینت (owner_id) این تسک‌ها رو از لیست مخفی می‌کنه،
// ولی کرون Push مستقیم از دیتابیس می‌خونه و هنوز براشون نوتیف می‌فرسته —
// چون خودِ داده هنوز آلوده‌ست، فقط نمایششون مخفی شده.
//
// این اسکریپت همه‌ی حساب‌ها رو می‌گرده، هر تسکی که owner_id‌اش با صاحب
// رکورد فرق داره رو پیدا می‌کنه، و اگه صاحب واقعی‌اش (owner_id) توی
// دیتابیس وجود داشته باشه، تسک رو از حساب فعلی برمی‌داره و می‌بره توی
// حساب واقعی‌اش (نه پاک کردن، چون ممکنه داده‌ی واقعی یک کاربر باشه).
//
// اجرا:
//   node backend/scripts/fix-misplaced-todos.js            → فقط گزارش می‌ده (dry-run)
//   node backend/scripts/fix-misplaced-todos.js --apply     → واقعاً اصلاح می‌کنه
//
// قبل از --apply حتماً از دیتابیس بکاپ بگیرید:
//   cp backend/database/teampulse.db backend/database/teampulse.db.bak

const path = require('path');
const db = require(path.join(__dirname, '..', 'config', 'database'));

const APPLY = process.argv.includes('--apply');

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

const accounts = db.prepare('SELECT id FROM accounts').all().map(a => String(a.id));
const accountIdSet = new Set(accounts);

const rows = db.prepare('SELECT account_id, data FROM user_data').all();

let totalForeign = 0;
let totalMoved = 0;
let totalUnresolved = 0;

const updates = []; // { account_id, data }

for (const row of rows) {
  const accountId = String(row.account_id);
  const data = safeParse(row.data);
  if (!data || !Array.isArray(data.todos) || data.todos.length === 0) continue;

  const keep = [];
  const foreign = [];

  for (const t of data.todos) {
    const ownerId = String(t?.owner_id || t?.ownerId || '').trim();
    if (!ownerId || ownerId === 'local-owner' || ownerId === accountId) {
      keep.push(t);
    } else {
      foreign.push(t);
    }
  }

  if (foreign.length === 0) continue;
  totalForeign += foreign.length;

  console.log(`\nحساب ${accountId}: ${foreign.length} تسک آواره پیدا شد`);
  for (const t of foreign) {
    console.log(`  - "${t.title}" → متعلق به حساب ${t.owner_id}${accountIdSet.has(String(t.owner_id)) ? '' : '  (⚠️ این حساب دیگه وجود نداره)'}`);
  }

  if (!APPLY) continue;

  // به حساب واقعی‌شون منتقلشون کن
  data.todos = keep;
  updates.push({ account_id: accountId, data });

  const byOwner = new Map();
  for (const t of foreign) {
    const ownerId = String(t.owner_id);
    if (!accountIdSet.has(ownerId)) { totalUnresolved++; continue; }
    if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
    byOwner.get(ownerId).push(t);
  }

  for (const [ownerId, todosToMove] of byOwner) {
    const targetRow = db.prepare('SELECT data FROM user_data WHERE account_id=?').get(ownerId);
    const targetData = targetRow ? (safeParse(targetRow.data) || {}) : {};
    if (!Array.isArray(targetData.todos)) targetData.todos = [];
    const existingIds = new Set(targetData.todos.map(x => String(x.id)));
    let movedHere = 0;
    for (const t of todosToMove) {
      // اگه از قبل توی حساب مقصد یک تسک با همین id بود، دوباره اضافه نکن
      if (existingIds.has(String(t.id))) continue;
      targetData.todos.push(t);
      movedHere++;
    }
    totalMoved += movedHere;
    updates.push({ account_id: ownerId, data: targetData, isTarget: true, hadRow: !!targetRow });
  }
}

if (!APPLY) {
  console.log(`\n[dry-run] جمعاً ${totalForeign} تسک آواره پیدا شد. برای اصلاح واقعی، اسکریپت رو با --apply اجرا کنید.`);
  process.exit(0);
}

const run = db.transaction(() => {
  for (const u of updates) {
    if (u.isTarget && !u.hadRow) {
      db.prepare("INSERT INTO user_data (account_id,data,updated_at) VALUES (?,?,datetime('now'))")
        .run(u.account_id, JSON.stringify(u.data));
    } else {
      db.prepare("UPDATE user_data SET data=?, updated_at=datetime('now') WHERE account_id=?")
        .run(JSON.stringify(u.data), u.account_id);
    }
  }
});
run();

console.log(`\n✅ انجام شد. ${totalMoved} تسک به حساب واقعی‌شون منتقل شد.`);
if (totalUnresolved > 0) {
  console.log(`⚠️ ${totalUnresolved} تسک صاحبشون (owner_id) دیگه توی دیتابیس نبود — این‌ها فقط از حساب اشتباه حذف شدن (چون جای درستی برای گذاشتنشون نیست).`);
}
