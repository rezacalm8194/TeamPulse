@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0"

rem One-click staging: push develop, then run server deploy over SSH.
set "STAGING_SSH=pachim@37.32.12.186"
set "STAGING_DIR=/home/pachim/staging.teampulse.ir"

echo.
echo ================================
echo  TeamPulse - Deploy STAGING
echo ================================
echo  Branch : develop
echo  Server : %STAGING_SSH%
echo  Site   : https://staging.teampulse.ir
echo ================================
echo.

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder is not a Git repository.
  echo.
  pause
  exit /b 1
)

echo Ensuring branch develop...
git fetch origin
if errorlevel 1 goto git_error

git show-ref --verify --quiet refs/heads/develop
if errorlevel 1 (
  git checkout -b develop origin/develop
) else (
  git checkout develop
)
if errorlevel 1 (
  echo.
  echo Could not switch to develop. Commit or stash local changes first.
  echo.
  pause
  exit /b 1
)

echo.
echo Pulling latest origin/develop...
git pull --ff-only origin develop
if errorlevel 1 (
  echo.
  echo Pull failed. Resolve conflicts, then run this file again.
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
  echo.
  echo Committing changes...
  git commit -m "deploy: staging update"
  if errorlevel 1 goto git_error
) else (
  echo.
  echo No new file changes to commit.
)

echo.
echo Pushing develop to GitHub...
git push -u origin develop
if errorlevel 1 goto git_error

echo.
echo Latest commit:
git log --oneline --decorate -1
echo.

echo Running remote deploy via SSH...
ssh -o BatchMode=yes -o ConnectTimeout=20 %STAGING_SSH% "cd %STAGING_DIR% && bash scripts/pachim-deploy-staging.sh"
if errorlevel 1 (
  echo.
  echo Remote deploy failed.
  echo Push to GitHub may still have succeeded.
  echo You can finish in Pachim with:
  echo   cd /home/pachim/staging.teampulse.ir
  echo   bash scripts/pachim-deploy-staging.sh
  echo.
  pause
  exit /b 1
)

echo.
echo ================================
echo  Staging deploy finished
echo ================================
echo Check:
echo   https://staging.teampulse.ir
echo   https://staging.teampulse.ir/api/health
echo.
pause
exit /b 0

:git_error
echo.
echo Git command failed. Check the message above.
echo.
pause
exit /b 1
