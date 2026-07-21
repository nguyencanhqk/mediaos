@echo off
chcp 65001 >nul
REM dev.bat - shim mo CLI MediaOS (nguon su that: ../mediaos.ps1). Chi ASCII trong file nay:
REM cmd doc .bat UTF-8 co dau se cat dong REM dai -> chay nham manh vun nhu lenh.
REM   Double-click -> menu (co muc PROD update/restart [21]-[26]).
REM   Kem tham so  -> chay thang lenh: dev.bat prod-update [fe^|api^|lms] / prod-restart [api^|lms] / prod-status
REM   Chi tiet: dev\README.md  (hoac go: m help)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\mediaos.ps1" menu
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\mediaos.ps1" %*
)
