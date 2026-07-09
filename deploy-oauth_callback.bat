@echo off
cd /d D:\TeamPulse
git add oauth_callback.html
git diff --cached --name-only | findstr "oauth_callback.html" >nul
if errorlevel 1 (
    echo.
    echo ⚠️  oauth_callback.html تغییری نداشته — چیزی push نشد.
) else (
    git commit -m "deploy: update oauth_callback.html"
    git push origin main
    echo.
    echo ✅ oauth_callback.html push شد!
)
pause
