@echo off
title MediaOS Auth (projects :5285)
cd /d "%~dp0..\apps\auth"
echo === MediaOS Auth login SPA - PROJECTS stack ===
echo     port 5285  ->  api http://localhost:3101
echo.
REM Vite expose bien VITE_* tu process.env -> override .env cua app (von tro :3100).
set VITE_API_URL=http://localhost:3101/api/v1
call pnpm exec vite --port 5285
