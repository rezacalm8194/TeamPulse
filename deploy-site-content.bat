@echo off
chcp 65001 >nul
cd /d D:\TeamPulse

echo.
echo ================================
echo  TeamPulse site/blog deploy
echo ================================
echo.

git status --short
echo.

echo Staging website, blog, SEO, app, service worker, and backend task files...
git add index.html
git add app.html
git add sw.js
git add robots.txt
git add sitemap.xml
git add llms.txt
git add blog
git add backend/database/schema.sql
git add backend/routes/tasks.js

echo.
echo Files staged:
git diff --cached --name-only
echo.

git diff --cached --quiet
if %errorlevel%==0 (
  echo No changes to commit.
  echo.
  pause
  exit /b 0
)

set COMMIT_MSG=deploy: update site content and blog

echo Committing...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo.
  echo Commit failed. Please check the message above.
  pause
  exit /b 1
)

echo.
echo Pushing to origin/main...
git push origin main
if errorlevel 1 (
  echo.
  echo Push failed. Please check your internet connection or GitHub access.
  pause
  exit /b 1
)

echo.
echo Done. Wait a little, then test:
echo https://teampulse.ir/blog/
echo https://teampulse.ir/sitemap.xml
echo https://teampulse.ir/llms.txt
echo.
pause
