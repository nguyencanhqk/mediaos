@echo off
title MediaOS API (projects :3101)
cd /d "%~dp0..\apps\api"
echo === MediaOS API - PROJECTS PM stack ===
echo     port 3101  /  DB mediaos_projectspm
echo.
REM Env that wins over .env files (config/load-env.ts bo qua key da co trong process.env).
REM Postgres role la cluster-global, nen chi can doi ten DB sang mediaos_projectspm.
set NODE_ENV=development
set API_PORT=3101
set DATABASE_URL=postgres://mediaos_app:changeme_app_only@localhost:5432/mediaos_projectspm
set DATABASE_DIRECT_URL=postgres://mediaos:changeme_dev_only@localhost:5432/mediaos_projectspm
set DATABASE_WORKER_URL=postgres://mediaos_worker:changeme_worker_only@localhost:5432/mediaos_projectspm
set AUTH_COOKIE_SECURE=false
set CORS_ORIGIN=http://localhost:5279,http://localhost:5285
set AUTH_REDIRECT_ALLOWLIST=http://localhost:5279
set TWO_FACTOR_ENFORCEMENT_ENABLED=false
call pnpm dev
