@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0.."
set "ROOT=%CD%"

echo ==================================================
echo            MediaOS  -  Quick Test (vitest)
echo ==================================================
echo  apps    : api  web  auth  admin  console  studio  people  projects  mobile
echo  packages: contracts  web-core  ui
echo.
set /p "app=Ten app/package: "

set "DIR="
if exist "%ROOT%\apps\%app%\package.json"     set "DIR=%ROOT%\apps\%app%"
if exist "%ROOT%\packages\%app%\package.json" set "DIR=%ROOT%\packages\%app%"

if not defined DIR (
  echo [loi] Khong tim thay app/package: %app%
  echo.
  pause
  goto :eof
)

cd /d "%DIR%"
echo.
echo === Test: %app%   (%DIR%) ===
echo.

if /i "%app%"=="mobile" (
  REM mobile dung jest
  call pnpm test
  goto done
)

set /p "filter=Loc theo file/pattern (Enter = chay tat ca): "
if "%filter%"=="" (
  call pnpm exec vitest run
) else (
  call pnpm exec vitest run %filter%
)

:done
echo.
echo === Xong ===
pause
endlocal
