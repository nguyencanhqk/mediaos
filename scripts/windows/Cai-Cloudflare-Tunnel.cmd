@echo off
REM Bấm đúp file này để mở giao diện cài Cloudflare Tunnel.
REM Phải nằm CÙNG THƯ MỤC với cloudflared-new-machine.ps1.
REM Unblock-File: file copy từ máy khác/USB bị Windows gắn dấu "tải từ Internet" -> PowerShell chặn.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -LiteralPath '%~dp0cloudflared-new-machine.ps1' -ErrorAction SilentlyContinue; & '%~dp0cloudflared-new-machine.ps1'"
if errorlevel 1 pause
