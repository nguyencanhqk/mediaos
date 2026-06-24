@echo off
chcp 65001 >nul
REM dev.bat — shim mở menu CLI MediaOS (nguồn sự thật: ../mediaos.ps1).
REM Double-click file này, hoặc gõ:  m menu  (xem m.cmd ở gốc repo).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\mediaos.ps1" menu
