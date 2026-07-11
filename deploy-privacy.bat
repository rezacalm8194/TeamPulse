@echo off
cd /d D:\TeamPulse
git add privacy.html
git diff --cached --name-only | findstr "privacy.html" >nul
if errorlevel 1 (
    echo.
    echo ⚠️  privacy.html تغییری نداشته — چیزی push نشد.
) else (
    git commit -m "deploy: update privacy.html"
    git push origin main
    echo.
    echo ✅ privacy.html push شد!
)
pause
