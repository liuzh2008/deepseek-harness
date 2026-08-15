@echo off
rem DeepSeek Harness 开机自启脚本
rem 启动 dsh web 服务，默认端口 http://127.0.0.1:3080

cd /d "C:\Users\Administrator\Documents\Qoder\2026-08-13\chat-1\deepseek-harness"

call pnpm dsh web
