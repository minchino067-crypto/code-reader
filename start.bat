@echo off
echo CodeReader を起動中...
cd /d "%~dp0"

:: サーバー起動（バックグラウンド）
start "CodeReader Server" cmd /c "node server.js"
timeout /t 2 /nobreak >nul

:: localtunnelでURL発行（このウィンドウに表示）
echo.
echo ==============================
echo  公開URLを取得しています...
echo ==============================
npx localtunnel --port 3000

pause
