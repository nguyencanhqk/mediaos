@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
cd /d "%~dp0.."
set "ROOT=%CD%"
set "DEV=%~dp0"

:menu
cls
echo ==================================================
echo            MediaOS  -  Dev Launcher
echo ==================================================
echo   Repo: %ROOT%
echo.
echo   [1] Khoi dong MAIN dev stack  (cong ty: demo)
echo        api:3100  auth:5275  web:5273  studio:5276  people:5277  console:5278
echo.
echo   [2] Khoi dong PROJECTS PM stack
echo        api:3101  auth:5285  projects:5279   (DB mediaos_projectspm)
echo.
echo   [3] Chi bat INFRA (docker: postgres/pgbouncer/valkey/minio)
echo   [4] TEST mot app / package  (vitest)
echo   [5] Seed du lieu DEMO  (DB mediaos)
echo   [6] Khoi phuc .env PROD  (.env.prod -^> .env)
echo   [7] Tat INFRA  (docker compose down)
echo   [8] Sync DB roles -^> DEV  (changeme_*) [chay khi login/test bao sai mat khau]
echo   [9] REBUILD       (pnpm install + pnpm build)
echo  [10] RESET DB      (down -v + up + migrate + setup-roles + seed)  [XOA SACH DATA]
echo   [0] Thoat
echo.
set /p "choice=Chon (0-10): "

if "%choice%"=="1" goto main
if "%choice%"=="2" goto projects
if "%choice%"=="3" goto infra
if "%choice%"=="4" goto test
if "%choice%"=="5" goto seed
if "%choice%"=="6" goto restoreprod
if "%choice%"=="7" goto stop
if "%choice%"=="8" goto syncroles
if "%choice%"=="9" goto rebuild
if "%choice%"=="10" goto reset
if "%choice%"=="0" goto end
goto menu

:main
echo.
echo [env] .env.dev -^> .env  (DEV flat-localhost)
copy /y "%ROOT%\.env.dev" "%ROOT%\.env" >nul
echo [infra] docker compose up -d ...
docker compose up -d
echo [wait] cho Postgres san sang...
timeout /t 4 >nul
start "MediaOS API :3100"     /d "%ROOT%\apps\api"     cmd /k pnpm dev
start "MediaOS auth :5275"    /d "%ROOT%\apps\auth"    cmd /k pnpm dev
start "MediaOS web :5273"     /d "%ROOT%\apps\web"     cmd /k pnpm dev
start "MediaOS studio :5276"  /d "%ROOT%\apps\studio"  cmd /k pnpm dev
start "MediaOS people :5277"  /d "%ROOT%\apps\people"  cmd /k pnpm dev
start "MediaOS console :5278" /d "%ROOT%\apps\console" cmd /k pnpm dev
echo.
echo  Mo trinh duyet: http://localhost:5273
echo  Login: companySlug=demo  email=admin@demo.local  pass=Admin@12345
echo.
pause
goto menu

:projects
echo.
echo [env] .env.dev -^> .env  (DEV base; api se override sang :3101 + DB projectspm)
copy /y "%ROOT%\.env.dev" "%ROOT%\.env" >nul
echo [infra] docker compose up -d ...
docker compose up -d
echo [wait] cho Postgres san sang...
timeout /t 4 >nul
start "MediaOS API :3101"      cmd /k call "%DEV%_api-projects.bat"
start "MediaOS auth :5285"     cmd /k call "%DEV%_auth-projects.bat"
start "MediaOS projects :5279" /d "%ROOT%\apps\projects" cmd /k pnpm dev
echo.
echo  Mo trinh duyet: http://localhost:5279
echo  Login: companySlug=funtime  email=admin@funtimemediacorp.com  pass=Admin@12345
echo  (Neu login fail: DB mediaos_projectspm chua duoc tao/migrate/seed.)
echo.
pause
goto menu

:infra
echo.
echo [infra] docker compose up -d ...
docker compose up -d
echo.
pause
goto menu

:test
call "%DEV%test.bat"
goto menu

:seed
echo.
echo [seed] tao company demo + admin (base) roi do du lieu (full)...
pushd "%ROOT%\apps\api"
node demo-seed-base.mjs
node demo-seed-full.mjs
popd
echo.
pause
goto menu

:restoreprod
echo.
echo [env] .env.prod -^> .env  (PROD)
copy /y "%ROOT%\.env.prod" "%ROOT%\.env" >nul
echo Da khoi phuc .env PROD.
echo.
pause
goto menu

:stop
echo.
echo [infra] docker compose down ...
docker compose down
echo.
pause
goto menu

:syncroles
echo.
echo [db] Sync DB role passwords -^> DEV (changeme_*) qua docker exec...
docker exec mediaos-postgres psql -U mediaos -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE mediaos_app WITH LOGIN PASSWORD 'changeme_app_only'" -c "ALTER ROLE mediaos_worker WITH LOGIN PASSWORD 'changeme_worker_only'" -c "ALTER ROLE mediaos WITH LOGIN PASSWORD 'changeme_dev_only'"
echo.
echo Da dong bo role ve dev. (Khoi phuc PROD: chay scripts/windows setup voi .env.prod.)
echo.
pause
goto menu

:rebuild
echo.
echo [rebuild] pnpm install ...
call pnpm install
echo [rebuild] pnpm build (turbo: contracts + api + web + cac app) ...
call pnpm build
echo.
echo  Rebuild xong.
echo.
pause
goto menu

:reset
echo.
echo  ============================================================
echo   RESET DB  -  XOA SACH toan bo du lieu docker (volume):
echo   postgres + minio + valkey.  KHONG THE HOAN TAC.
echo  ============================================================
set /p "ok=Go  RESET  de xac nhan (rong = huy): "
if /i not "%ok%"=="RESET" ( echo Da huy. & echo. & pause & goto menu )
echo.
echo [env] .env.dev -^> .env  (DEV flat-localhost)
copy /y "%ROOT%\.env.dev" "%ROOT%\.env" >nul
echo [reset] docker compose down -v  (xoa volume) ...
docker compose down -v
echo [reset] docker compose up -d ...
docker compose up -d
echo [wait] cho Postgres san sang...
timeout /t 6 >nul
echo [reset] migrate  (tao schema + role) ...
call pnpm db:migrate
echo [reset] nap .env + setup DB role passwords (changeme_*) ...
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ROOT%\.env") do set "%%A=%%B"
call pnpm db:setup-roles
echo [reset] seed demo (base + full) ...
pushd "%ROOT%\apps\api"
node demo-seed-base.mjs
node demo-seed-full.mjs
popd
echo.
echo  RESET xong: DB sach + migrate + role + seed.
echo  Login: companySlug=demo  email=admin@demo.local  pass=Admin@12345
echo.
pause
goto menu

:end
endlocal
