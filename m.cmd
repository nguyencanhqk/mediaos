@echo off
REM m.cmd - wrapper cho mediaos.ps1. Go:  m dev | m build | m reset | m deploy ...
REM Chay tu goc repo (hoac them goc repo vao PATH de go `m` tu bat ky dau).
REM PHAI ASCII KHONG DAU: ky tu UTF-8 nhieu byte trong .cmd lam cmd.exe parse sai DONG KE TIEP khi
REM console o codepage 65001 -> loi that da gap: "ediaos.ps1. is not recognized" (mat 1 ky tu dau path).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0mediaos.ps1" %*
