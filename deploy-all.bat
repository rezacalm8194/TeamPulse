@echo off
chcp 65001 >nul
cd /d D:\TeamPulse

echo.
echo ================================
echo  TeamPulse full deploy
echo ================================
echo.

git status --short
echo.

echo Staging all project changes except temporary deploy files...
git add -A
git reset -- changed.tmp >nul 2>nul

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

set COMMIT_MSG=deploy: update TeamPulse

echo Committing...
git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
  echo.
  echo Commit failed. Please check the message above.
  pause
  exit /b 1
)

echo.
echo Refreshing remote branches...
git fetch origin
if errorlevel 1 (
  echo.
  echo Fetch failed. Please check your internet connection or GitHub access.
  pause
  exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set CURRENT_BRANCH=%%B
if /i not "%CURRENT_BRANCH%"=="develop" (
  echo.
  echo Deploy must run from the develop branch. Current branch: %CURRENT_BRANCH%
  pause
  exit /b 1
)

echo Integrating the latest production commit...
git merge --no-edit origin/main
if errorlevel 1 (
  echo.
  echo Merge failed. Resolve the conflict before deploying.
  pause
  exit /b 1
)

echo.
echo Pushing develop...
git push origin HEAD:develop
if errorlevel 1 (
  echo.
  echo Develop push failed. Please check the message above.
  pause
  exit /b 1
)

echo.
echo Creating or reusing a pull request for main...
for /f "delims=" %%P in ('gh pr list --head develop --base main --state open --json number --jq ".[0].number"') do set PR_NUMBER=%%P
if not defined PR_NUMBER (
  for /f "delims=" %%P in ('gh pr create --base main --head develop --title "%COMMIT_MSG%" --body "Automated production deploy from develop."') do set PR_URL=%%P
  for /f "delims=" %%P in ('gh pr list --head develop --base main --state open --json number --jq ".[0].number"') do set PR_NUMBER=%%P
)
if not defined PR_NUMBER (
  echo.
  echo Pull request creation failed.
  pause
  exit /b 1
)

echo Merging pull request #%PR_NUMBER%...
gh pr merge %PR_NUMBER% --merge
if errorlevel 1 (
  echo.
  echo Pull request merge failed. Check repository rules or required checks.
  pause
  exit /b 1
)

echo.
echo Done. Wait a little, then hard refresh:
echo https://teampulse.ir/app?v=latest
echo.
pause
