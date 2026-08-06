@echo off
cd /d D:\TeamPulse
git add app.html xlsx.full.min.js
git commit -m "update app.html"
git push origin main
echo.
echo ✅ Deploy شد! سرور داره pull می‌کنه...
