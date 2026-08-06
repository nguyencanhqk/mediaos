@echo off
chcp 65001 >nul
REM dev.bat - shim mo CLI MediaOS (nguon su that: ../mediaos.ps1). Chi ASCII trong file nay:
REM cmd doc .bat UTF-8 co dau se cat dong REM dai -> chay nham manh vun nhu lenh.
REM   Double-click -> menu (co muc PROD update/restart [21]-[27]).
REM   Kem tham so  -> chay thang lenh: dev.bat prod-update [fe^|api^|lms^|social] / prod-restart [api^|lms^|social] / prod-status
REM
REM   SOCIAL = app ve tinh fbpost (dang bai Facebook Page), cong 3500, service MediaOS-Social.
REM     [27] hoac: dev.bat prod-update social  -> npm build apps\fbpost -> restart -> KIEM CONG PHIEN.
REM     Cong phien phai tra 401 o GET /api/pages; khac 401 la bao DO va dung mo ra ngoai (DEVOPS-14).
REM
REM   PROD update co API ([21]/[23], hoac: dev.bat prod-update api) chay build -> MIGRATE -> restart.
REM     Migrate do hoac bi huy = KHONG restart + thoat code 1 (fail-closed). Ly do: "dist moi chay tren
REM     schema cu" moi la trang thai xau nhat (su co 2026-07-24: thieu migration 0511 -> job nen Failed
REM     moi nhip, api.err.log phinh 149 MB).
REM     Lo ton dong co REVOKE/DROP -> DUNG LAI hoi xac nhan (go MIGRATE). Chay khong tuong tac thi dat
REM     bien MEDIAOS_MIGRATE_YES=1. Xem truoc so migration con no: dev.bat prod-status ([25]).
REM   Chi tiet: dev\README.md  (hoac go: m help)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\mediaos.ps1" menu
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\mediaos.ps1" %*
)
