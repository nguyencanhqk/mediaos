@echo off
REM m.cmd — wrapper cho mediaos.ps1. Gõ:  m dev | m build | m reset | m deploy ...
REM Chạy từ gốc repo (hoặc thêm gốc repo vào PATH để gõ `m` từ bất kỳ đâu).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediaos.ps1" %*
