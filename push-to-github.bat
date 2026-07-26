@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo.
echo ================================
echo  TeamPulse - Push to GitHub
echo ================================
echo.

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder is not a Git repository.
  echo.
  pause
  exit /b 1
)

echo Fetching latest origin/main...
git fetch origin
if errorlevel 1 goto git_error

echo.
echo Rebasing local work on origin/main...
git pull --rebase --autostash origin main
if errorlevel 1 (
  echo.
  echo Pull/rebase failed. Resolve conflicts, then run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo Staging project changes...
git add -A
git restore --staged changed.tmp >nul 2>nul

echo.
echo Staged files:
git diff --cached --name-only

git diff --cached --quiet
if errorlevel 1 (
  set "COMMIT_MSG=deploy: update TeamPulse %date% %time%"
  echo.
  echo Committing changes...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 goto git_error
) else (
  echo.
  echo No new file changes to commit.
)

echo.
echo Pushing main to GitHub...
git push origin main
if errorlevel 1 goto git_error

echo.
echo Done. GitHub is up to date.
echo Latest commit:
git log --oneline --decorate -1
echo.
pause
exit /b 0

:git_error
echo.
echo Git command failed. Check the message above.
echo.
pause
exit /b 1
