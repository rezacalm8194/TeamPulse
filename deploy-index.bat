@echo off
cd /d D:\TeamPulse

git add index.html

git diff --cached --name-only | findstr "index.html" >nul
if errorlevel 1 (
    echo.
    echo ⚠️  index.html تغییری نداشته — چیزی push نشد.
) else (
    git commit -m "deploy: update index.html"
    git push origin main
    echo.
    echo ✅ index.html push شد!
)

pause