@echo off
cd /d D:\TeamPulse

git add -A

git status

git diff --cached --name-only > changed.tmp
set /p CHANGED=