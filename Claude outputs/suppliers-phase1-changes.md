# فاز ۱ تامین‌کنندگان — خلاصه تغییرات

## فایل‌های تغییرکرده

| فایل | توضیح |
|------|--------|
| `backend/utils/businessStore.js` | مجموعه `purchases`، فاز ۷ مهاجرت، `dateKey`/`searchableText`، جست‌وجوی `supplier_category` در students |
| `backend/utils/partyRoles.js` | تابع `partyRoles` برای `is_client` / `is_supplier` و سازگاری قدیمی |
| `backend/utils/supplierFinanceSummary.js` | محاسبه خالص بدهی تامین‌کننده (چند ارز، جدا از مانده مشتری) |
| `backend/utils/deletedItems.js` | حذف `purchases` هنگام حذف student در tombstone |
| `backend/utils/staticServing.js` | سرو `app-suppliers.js` |
| `backend/tests/suppliers-phase1.test.js` | تست‌های فاز ۱ (جدید) |
| `backend/tests/csp-onclick-pages.test.js` | فیکسچر کلیک صفحه suppliers و بارگذاری chunk |
| `app.js` | ماژول `suppliers`، `_partyRoles`، API `purchases`، همگام‌سازی `supplier_payment`، فرم student، فیلتر مشتری، تنظیمات بخش‌ها |
| `app-finance.js` | صورتحساب طرف تامین‌کننده در `_buildPartyTxItems` |
| `app-suppliers.js` | UI چهار تب، مودال خرید/پرداخت، صفحه suppliers (جدید) |
| `app.html` | آیتم منوی «تامین‌کنندگان» زیر امور مشتریان |

## خروجی تست

```
npm test (کل سوئیت): 654 تست — 586 pass، 68 fail (خروج 1)
```

تست‌های جدید فاز ۱:

```
node --test tests/suppliers-phase1.test.js
→ 6/6 pass
```

`business-store.test.js` (شامل phase 7): همه pass.

**نکته:** بیشتر شکست‌های کل `npm test` از قبل وجود داشتند (مثلاً `asset version is tp451` در حالی که `TP_ASSET_V` عمداً توسط deploy عوض می‌شود؛ و `version-snapshots` با `SQLITE_ERROR` در محیط فعلی). تست CSP پس از اضافه شدن فیکسچر `suppliers` باید سبز شود.

## تصمیم‌ها / انحراف‌ها

1. **لیست ماژول‌ها (`WORKSPACE_MODULES`)** در کد جدید تعریف شد (شامل `todolist`، `dashboard`، `suppliers`) چون در ریپو لیست جداگانه‌ای برای روشن/خاموش workspace پیدا نشد؛ فقط `suppliers` پیش‌فرض **خاموش** است؛ `todolist`/`dashboard` پیش‌فرض روشن بدون تغییر رفتار.
2. **پرداخت تامین‌کننده** مثل `staff_payment` فقط در **`expenses`** با `source: 'supplier_payment'` ذخیره می‌شود؛ خود `purchases` در جمع هزینه حساب نمی‌شود.
3. **صورتحساب تامین‌کننده** در `app-suppliers.js` با `mode: 'supplier'` به `_openPartyTransactions` وصل شد؛ برچسب‌های فارسی در `app-finance.js`.
4. **`TP_ASSET_V` / `sw.js`** طبق دستور شما دست نخورده است.