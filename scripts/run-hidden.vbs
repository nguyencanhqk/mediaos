' run-hidden.vbs — chạy một lệnh KHÔNG hiện cửa sổ console, dùng cho Windows Task Scheduler.
'
' VÌ SAO CẦN: task `MediaOS-OpsAlert` (RELEASE-09 §4) chạy `node scripts\ops-alert-check.mjs`
' mỗi 10 phút dưới LogonType=Interactive. Windows luôn cấp một conhost cho tiến trình console
' chạy trong phiên đăng nhập ⇒ cửa sổ đen nháy lên ~1 giây rồi tắt, 6 lần/giờ, suốt ngày.
' Cách "chính thống" để hết nháy là đổi task sang chạy trong session 0
' ("Run whether user is logged on or not"), NHƯNG session 0 không với tới được Docker Desktop
' pipe của người dùng ⇒ `psql`/`docker exec` trong ops-alert-check.mjs hỏng ⇒ hai luật
' "lệch migration" và "job nền thất bại" tụt xuống `unknown` VĨNH VIỄN. Đổi một cảnh báo đúng
' lấy một cảnh báo mù thì thà để nó nháy. Wrapper này giữ nguyên phiên đăng nhập (Docker vẫn
' với tới) và chỉ giấu cửa sổ.
'
' GIỮ MÃ THOÁT: chạy đồng bộ (bWaitOnReturn=True) rồi trả đúng exit code của lệnh con, để
' `(Get-ScheduledTaskInfo).LastTaskResult` vẫn là tín hiệu thật. Nếu chạy bất đồng bộ thì task
' luôn báo 0 và ta mất khả năng biết cảnh báo có nổ hay không.
'
' DÙNG:
'   wscript.exe "<repo>\scripts\run-hidden.vbs" "<thư mục làm việc>" "<lệnh đầy đủ>"

Option Explicit

Dim shell, args, workDir, command, exitCode

Set args = WScript.Arguments
If args.Count < 2 Then
  ' Thiếu tham số là lỗi cấu hình, không phải "không có gì để làm" — trả mã riêng để phân biệt.
  WScript.Quit 3
End If

workDir = args(0)
command = args(1)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = workDir
exitCode = shell.Run(command, 0, True)

WScript.Quit exitCode
