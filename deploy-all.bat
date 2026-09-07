@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

rem One-click production: promote develop -> main on GitHub, then sync the
rem live server over SSH (same host pattern as deploy-staging.bat).
set "PROD_SSH=pachim@37.32.12.186"
set "PROD_DIR=/home/pachim/TeamPulse.ir"
set "COMMIT_MSG=deploy: update TeamPulse"

echo.
echo ================================
echo  TeamPulse full deploy
echo ================================
echo  Branch : develop -^> main
echo  Server : %PROD_SSH%
echo  Site   : https://teampulse.ir
echo ================================
echo.

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo This folder is not a Git repository.
  echo.
  pause
  exit /b 1
)

echo Refreshing remote branches...
git fetch origin
if errorlevel 1 goto git_error

echo Ensuring branch develop...
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
echo Staging all project changes except temporary deploy files...
git add -A
git restore --staged changed.tmp >nul 2>nul
git reset -- changed.tmp >nul 2>nul

echo.
echo Files staged:
git diff --cached --name-only
echo.

git diff --cached --quiet
if errorlevel 1 (
  echo Committing...
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 goto git_error
) else (
  echo No local changes to commit; continuing promote to main...
)

echo.
echo Integrating the latest remote develop...
git merge --no-edit origin/develop
if errorlevel 1 (
  echo.
  echo Merge of origin/develop failed. Resolve the conflict before deploying.
  pause
  exit /b 1
)

echo Integrating the latest production commit...
git merge --no-edit origin/main
if errorlevel 1 (
  echo.
  echo Merge of origin/main failed. Resolve the conflict before deploying.
  pause
  exit /b 1
)

echo.
echo Pushing develop...
git push -u origin develop
if errorlevel 1 goto git_error

echo.
echo Latest develop commit:
git log --oneline --decorate -1
echo.

rem Skip PR when develop already matches main (still run remote sync below).
for /f "delims=" %%A in ('git rev-parse origin/develop') do set DEV_SHA=%%A
for /f "delims=" %%A in ('git rev-parse origin/main') do set MAIN_SHA=%%A
if /i "!DEV_SHA!"=="!MAIN_SHA!" (
  echo develop already matches main; skipping pull request.
  goto remote_deploy
)

echo Creating or reusing a pull request for main...
set "PR_NUMBER="
for /f "delims=" %%P in ('gh pr list --head develop --base main --state open --json number --jq ".[0].number"') do set PR_NUMBER=%%P
if not defined PR_NUMBER (
  gh pr create --base main --head develop --title "%COMMIT_MSG%" --body "Automated production deploy from develop." >nul
  for /f "delims=" %%P in ('gh pr list --head develop --base main --state open --json number --jq ".[0].number"') do set PR_NUMBER=%%P
)
if not defined PR_NUMBER (
  echo.
  echo Pull request creation failed.
  pause
  exit /b 1
)

echo Merging pull request #!PR_NUMBER!...
gh pr merge !PR_NUMBER! --merge
if errorlevel 1 (
  echo.
  echo Pull request merge failed. Check repository rules or required checks.
  pause
  exit /b 1
)

git fetch origin main

:remote_deploy
echo.
echo Syncing production server via SSH...
rem Refresh the deploy script from GitHub first so a dirty/old server tree
rem can still run the hardened reset path.
ssh -o BatchMode=yes -o ConnectTimeout=20 %PROD_SSH% "cd %PROD_DIR% && git fetch origin main && git checkout origin/main -- scripts/pachim-deploy.sh && bash scripts/pachim-deploy.sh"
if errorlevel 1 (
  echo.
  echo Remote deploy failed.
  echo GitHub promote may still have succeeded.
  echo Finish on the server with:
  echo   cd /home/pachim/TeamPulse.ir
  echo   git fetch origin main
  echo   git checkout origin/main -- scripts/pachim-deploy.sh
  echo   bash scripts/pachim-deploy.sh
  echo.
  pause
  exit /b 1
)

echo.
echo ================================
echo  Production deploy finished
echo ================================
echo Hard refresh:
echo   https://teampulse.ir/app?v=latest
echo Health:
echo   https://teampulse.ir/api/health
echo.
curl -fsS https://teampulse.ir/api/health
echo.
echo.
pause
exit /b 0

:git_error
echo.
echo Git command failed. Check the message above.
echo.
pause
exit /b 1
