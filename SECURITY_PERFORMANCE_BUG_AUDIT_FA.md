# گزارش ممیزی سرعت، باگ و امنیت TeamPulse

تاریخ بررسی: ۱۴۰۵/۰۷/۱۲ (۲۰۲۶-۱۰-۰۴)

## خلاصه مدیریتی

وضعیت کلی پروژه «قابل استفاده، اما آماده انتشار بدون اصلاح نیست» ارزیابی می‌شود.

- امنیت پایه بک‌اند از نظر JWT، ابطال توکن، CORS، محدودیت نرخ، CSP، کنترل دسترسی فایل و جلوگیری از اجرای فایل آپلودی نسبتاً خوب طراحی شده است.
- مهم‌ترین ریسک فوری، آسیب‌پذیری‌های شناخته‌شده وابستگی‌ها است: `npm audit` تعداد ۵ زنجیره آسیب‌پذیر شامل ۴ مورد High و ۱ مورد Moderate گزارش کرد.
- مجموعه تست در وضعیت قرمز است: ۳۴۵ تست اجرا شد؛ ۳۲۷ پاس و ۱۸ تست شکست خورد.
- شکست‌های تست فقط ظاهری نیستند؛ چند مورد به بازگشت داده حذف‌شده، ناقص ماندن hydration، از دست رفتن تغییرات محلی و همگام‌سازی Todo بین موبایل و دسکتاپ مربوط‌اند.
- حجم JavaScript اولیه زیاد است: `app.js` حدود ۱.۴۷ مگابایت خام و `app.css` حدود ۲۶۲ کیلوبایت خام است. تقسیم lazy برای چند بخش وجود دارد، اما bundle اصلی هنوز بزرگ است.
- یک کپی کامل دیگر از پروژه در مسیر `teampulse/` داخل ریشه static وجود دارد. محافظ فعلی مسیرهای حساس فقط مسیرهای سطح اول را مسدود می‌کند؛ بنابراین بخشی از سورس بک‌اند و فایل‌های توسعه در مسیر تو‌در‌تو ممکن است به‌صورت عمومی قابل دریافت باشند.

## یافته‌های بحرانی و مهم

### ۱. وابستگی‌های دارای آسیب‌پذیری شناخته‌شده — شدت High

`npm audit --omit=dev` پنج زنجیره آسیب‌پذیر پیدا کرد:

| بسته | نسخه نصب‌شده | شدت | ریسک اصلی |
|---|---:|---:|---|
| `multer` | 2.2.0 | High | چند DoS در multipart، نشت file descriptor و باقی‌ماندن فایل‌های ناقص |
| `nodemailer` | 9.0.1 | High | DoS در address parser، bypassهای آدرس/دامنه و ریسک‌های TLS/DNS |
| `brace-expansion` | 5.0.6 | High | مصرف شدید CPU/RAM و stack exhaustion |
| `ip-address` | 10.2.0 | High | bypass در تشخیص IP و SSRF/trust-boundary |
| `qs` | 6.15.2 | Moderate | DoS و دورزدن محدودیت آرایه |

اثر واقعی `multer` بالاست، چون دو endpoint آپلود فعال دارد: فایل عمومی workspace با سقف ۱۰MB و صوت با `memoryStorage` و سقف ۲۵MB. `nodemailer` نیز dependency مستقیم است، هرچند شدت exploit به نحوه استفاده از ورودی کاربر بستگی دارد.

اقدام پیشنهادی: ارتقای فوری lockfile با نسخه‌های امن، سپس اجرای کامل تست‌ها. نسخه امن باید با خروجی روز `npm audit` تعیین شود؛ audit فعلی اعلام می‌کند برای همه موارد fix موجود است.

### ۲. احتمال افشای سورس و فایل‌های توسعه از مسیر static تو‌در‌تو — شدت High

ریشه static کل پوشه پروژه است. تابع `blockSensitiveStatic` مسیر `/backend` را در سطح اول می‌بندد، اما الگوی آن مسیر `/teampulse/backend/...` را پوشش نمی‌دهد. در همین repository یک کپی کامل شامل `teampulse/backend/package.json`، routeها، schema، تست‌ها و ابزارها وجود دارد.

پیامد:

- افشای سورس بک‌اند، ساختار دیتابیس، endpointها و جزئیات کنترل دسترسی؛
- افزایش سطح حمله و کمک به reconnaissance؛
- احتمال افشای فایل‌های پیش‌بینی‌نشده‌ای که در آینده به این کپی اضافه شوند.

اقدام پیشنهادی: به‌جای denylist، static root را به یک پوشه public محدود کنید یا allowlist صریح برای assetهای قابل انتشار بسازید. پوشه `teampulse/` نیز نباید زیر static root production باشد.

### ۳. ۱۸ تست شکست‌خورده و ریسک از دست رفتن/بازگشت داده — شدت High

نتیجه اجرای `npm test`:

- کل: ۳۴۵
- موفق: ۳۲۷
- ناموفق: ۱۸
- زمان: حدود ۴.۵ ثانیه

مهم‌ترین شکست‌ها:

- حذف‌های آرشیو ممکن است با پاسخ pagination در حال پرواز دوباره ظاهر شوند.
- hydration ناقص ممکن است وضعیت اشتباه بسازد یا تغییرات محلی unsynced را نگه ندارد.
- سناریوهای باز کردن تیک Todo بین Android و desktop در چهار حالت شکست می‌خورند.
- continuation ناموفق صفحه Todo به‌درستی retry نمی‌شود.
- document polling ممکن است hydration ناموفق را sync‌شده تلقی کند.
- ذخیره document در SQLite parts و patch محدود به collection تغییرکرده شکست دارد.
- ثبت audit Todo و logging integration شکست دارد.
- parser مربوط به CSP/inline handler یک regression دارد.
- نسخه فونت در CSS (`tp318`) با asset جاری (`tp331`) هماهنگ نیست.

این موارد باید قبل از انتشار به دو گروه تفکیک شوند: regression واقعی یا تست قدیمی. با توجه به ماهیت سناریوهای sync، تا وقتی دلیل هر شکست مشخص نشده، نباید آن‌ها را صرفاً stale test فرض کرد.

### ۴. آپلود صوت ۲۵MB در RAM — شدت Medium/High

مسیر speech از `multer.memoryStorage()` استفاده می‌کند و هر درخواست می‌تواند تا ۲۵MB را در حافظه نگه دارد. با وجود rate limit، چند درخواست همزمان می‌تواند memory pressure ایجاد کند؛ ضمن اینکه نسخه فعلی `multer` نیز چند DoS شناخته‌شده دارد.

اقدام پیشنهادی:

- ابتدا ارتقای `multer`؛
- انتقال آپلود صوت به disk/stream؛
- محدودیت همزمانی مستقل برای transcription؛
- timeout و سقف duration صوت پیش از تبدیل کامل؛
- queue محدود برای `ffmpeg` و Vosk.

### ۵. Host header در لینک اشتراک — شدت Medium

URL بازگشتی share از `req.get('host')` ساخته می‌شود. مهاجم می‌تواند با Host ساختگی، پاسخ API را به لینکی با دامنه دلخواه تبدیل کند. خود token تصادفی و صفحه دارای `script-src 'none'` است، بنابراین این مورد takeover مستقیم نیست، اما برای phishing و لینک نادرست ریسک دارد.

اقدام پیشنهادی: URL را فقط از `PUBLIC_BASE_URL` معتبر بسازید؛ مشابه رویکردی که در بخش Bale Pay دیده می‌شود.

### ۶. سیاست CSP قابل قبول ولی بیش از حد باز در اتصال‌ها — شدت Medium

نکات مثبت: inline script مجاز نیست، `object-src 'none'` و `base-uri 'self'` فعال‌اند و صفحه share حتی `script-src 'none'` دارد.

ریسک باقی‌مانده: `connect-src 'self' https:` و چند directive دیگر کل HTTPS را مجاز می‌کنند. در صورت XSS یا سوءاستفاده از API مرورگر، exfiltration به هر مقصد HTTPS ساده‌تر می‌شود.

اقدام پیشنهادی: دامنه‌های واقعی مورد نیاز را allowlist کنید و CSP را با `report-to`/`report-uri` در حالت گزارش مانیتور کنید.

### ۷. اعتماد به یک proxy ثابت — شدت وابسته به استقرار

`app.set('trust proxy', 1)` همراه rate limit درست است فقط اگر production دقیقاً یک reverse proxy قابل اعتماد داشته باشد. در topology متفاوت، IP کلاینت ممکن است اشتباه تشخیص داده شود و rate limit قابل دورزدن یا باعث محدود شدن کاربران مشترک شود.

اقدام پیشنهادی: topology سرور را مستند و `trust proxy` را متناسب با proxy واقعی تنظیم و با تست `X-Forwarded-For` اعتبارسنجی کنید.

## ارزیابی سرعت

### نکات مثبت

- بخش‌های `app-extra.js`، `app-todos.js`، `app-finance.js` و `app-sessions.js` به‌صورت lazy بارگذاری می‌شوند.
- فایل‌های versioned با cache یک‌ساله و `immutable` سرو می‌شوند.
- Brotli/Gzip پشتیبانی شده و sidecar قدیمی فقط وقتی استفاده می‌شود که از سورس جدیدتر باشد.
- فونت‌ها self-host هستند و فونت Regular preload می‌شود.
- SQLite روی WAL، foreign keys و busy timeout تنظیم شده است.
- endpointهای API با `no-store` سرو می‌شوند.

### مشکلات و فرصت‌های بهبود

1. `app.js` خام حدود ۱.۴۷MB است. حتی با Brotli قبلی حدود ۲۳۳KB بوده؛ parse/compile چنین فایل بزرگی روی موبایل ضعیف می‌تواند کند باشد.
2. `app.css` خام حدود ۲۶۲KB است و احتمال CSS بلااستفاده زیاد است.
3. `xlsx.full.min.js` حدود ۹۵۲KB است؛ خوشبختانه dynamic load دارد، اما باید اطمینان حاصل شود فقط هنگام import/export اکسل بارگیری می‌شود.
4. precompression در startup به‌صورت background اجرا می‌شود. اولین درخواست‌های بعد از deploy ممکن است مجبور به compression پویا شوند و CPU/TTFB بیشتری مصرف کنند. بهتر است precompression در build/deploy انجام شود.
5. mismatch نسخه فونت (`tp318`) با نسخه app (`tp331`) باعث شکست تست و cache invalidation ناقص می‌شود؛ کاربران ممکن است فونت قدیمی را طولانی نگه دارند.
6. یک کپی کامل `teampulse/` حجم deploy و crawl سطح static را بی‌دلیل بالا می‌برد.

اولویت بهینه‌سازی:

1. شکستن `app.js` بر اساس صفحه/feature و نگه‌داشتن shell اولیه زیر حدود ۱۵۰–۲۰۰KB فشرده؛
2. تولید assetهای فشرده در CI/deploy؛
3. حذف CSS بلااستفاده و جداسازی CSS صفحه‌های سنگین؛
4. اندازه‌گیری production با Lighthouse/WebPageTest روی موبایل و ثبت LCP، INP، CLS، TTFB و total blocking time؛
5. budget خودکار برای اندازه asset و زمان startup در CI.

## ارزیابی امنیت مثبت

- JWT فقط HS256 را قبول می‌کند، `jti` و token version دارد و TTL حداکثر ۷ روز است؛ مقدار پیش‌فرض ۸ ساعت است.
- نبود `JWT_SECRET` باعث fail-fast می‌شود.
- حساب غیرفعال و token revoked رد می‌شوند.
- login/register و endpointهای حساس rate limit جدا دارند.
- CORS wildcard را حذف و originها را allowlist می‌کند.
- خطاهای ۵۰۰ در production sanitize می‌شوند.
- آپلود فایل workspace روی disk انجام می‌شود، quota و اندازه دارد، access control روی owner/workspace دارد و MIME فعال به download امن تبدیل می‌شود.
- traversal در storage driver و Range response تست شده است.
- HTML/SVG/JS آپلودی inline اجرا نمی‌شود و `nosniff`/sandbox/attachment اعمال می‌شود.
- tokenهای Bale در storage رمز می‌شوند و webhook secret با مقایسه ثابت‌زمان بررسی می‌شود.
- صفحات share اسکریپت را کاملاً می‌بندند.

## باگ‌ها و بدهی‌های فنی دیگر

- syntax همه ۱۲۱ فایل JavaScript بررسی‌شده صحیح است؛ مشکل اصلی syntax نیست، رفتار و integration است.
- تست logging و process shutdown ناموفق است؛ قابلیت مشاهده و خروج تمیز پس از fatal error قابل اتکا نیست تا علت مشخص شود.
- route speech بعد از `router.use(auth)` دوباره `auth` را روی `/transcribe` اجرا می‌کند؛ آسیب امنیتی ندارد، اما query اضافه دیتابیس و log تکراری محتمل است.
- endpoint health مربوط به speech برای هر درخواست `ffmpeg`، `ffprobe` و import پایتون را probe می‌کند؛ این endpoint authenticated است، ولی برای health polling سنگین است و باید نتیجه cache کوتاه‌مدت داشته باشد.
- error handling ثبت‌نام/ورود هنوز در route متن exception را می‌سازد؛ middleware production آن را sanitize می‌کند، اما بهتر است route از ابتدا error code ثابت برگرداند.

## برنامه اصلاح پیشنهادی

### فوری — قبل از انتشار بعدی

1. ارتقای `multer`، `nodemailer` و dependencyهای transitively آسیب‌پذیر و اجرای دوباره audit.
2. بستن static root و حذف دسترسی عمومی به `teampulse/backend` و فایل‌های توسعه.
3. تعیین علت ۱۸ شکست و صفر کردن test suite، به‌خصوص sync، archive و document store.
4. هماهنگ کردن نسخه فونت با `TP_ASSET_V` و service worker.

### کوتاه‌مدت

1. تبدیل speech upload از memory به disk/stream و افزودن concurrency guard.
2. استفاده از `PUBLIC_BASE_URL` در لینک share.
3. اجرای Lighthouse/WebPageTest از شبکه واقعی و تعیین performance budget.
4. precompress در deploy، نه startup.
5. افزودن تستی که تمام مسیرهای static ممنوع—including nested paths—را پوشش دهد.

### میان‌مدت

1. کوچک‌سازی bundle اصلی و code splitting بیشتر.
2. CSP محدودتر و فعال‌سازی گزارش violation.
3. تست load برای sync، upload، speech، admin و notification.
4. مانیتورینگ نرخ ۴۰۹ sync conflict، خطاهای hydration، queue depth و memory RSS.

## روش بررسی و محدودیت‌ها

بررسی شامل خواندن ساختار و مسیرهای حساس، اجرای کامل تست‌ها، syntax check روی ۱۲۱ فایل JavaScript، `npm audit` آنلاین، بررسی اندازه assetها و کنترل‌های static/cache/CSP/auth/upload بوده است.

اتصال از محیط بررسی به `https://teampulse.ir/app` برقرار نشد؛ بنابراین این گزارش شامل اندازه‌گیری معتبر production برای TTFB، Core Web Vitals، TLS، CDN و headerهای واقعی reverse proxy نیست. این بخش باید از یک شبکه بیرونی و مرورگر واقعی تکمیل شود.
