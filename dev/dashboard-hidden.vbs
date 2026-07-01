' dashboard-hidden.vbs - khoi dong MediaOS dashboard AN (khong cua so), cong 5180.
' Doc LIVE harness/backlog.mjs + git tu repo that. Dung: menu [16] hoac taskkill node cong 5180.
Option Explicit
Dim sh, node, script, cmd
node   = "C:\Program Files\nodejs\node.exe"
script = "C:\dev 2\MediaOS\harness\dashboard\server.mjs"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\dev 2\MediaOS"
cmd = Chr(34) & node & Chr(34) & " " & Chr(34) & script & Chr(34)
' 0 = cua so AN ; False = khong cho (chay nen, detached)
sh.Run cmd, 0, False
