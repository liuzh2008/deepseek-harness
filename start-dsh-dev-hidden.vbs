' start-dsh-dev-hidden.vbs
' Launches start-dsh-dev.cmd completely hidden (no console window flash)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness-dev"
sh.Run "cmd /c start-dsh-dev.cmd", 0, False