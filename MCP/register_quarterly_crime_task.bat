@echo off
chcp 65001 > nul
echo ========================================================
echo   경찰청 범죄 통계 3개월 주기 자동 재수집 Windows 스케줄러 등록
echo ========================================================
echo.

set TASK_NAME=QuarterlyCrimeDataSync
set SCRIPT_PATH=C:\practice\geminiCLI\realestate_prj\MCP\schedule_crime_sync.js

:: 1주일에 1회씩 일요일 새벽 3시에 schedule_crime_sync.js를 실행하여 90일(3개월) 경과 시 자동 수집
schtasks /create /tn "%TASK_NAME%" /tr "node \"%SCRIPT_PATH%\"" /sc weekly /d SUN /st 03:00 /f

if %ERRORLEVEL% equ 0 (
    echo.
    echo [성공] Windows 작업 스케줄러 '%TASK_NAME%' 등록 완료!
    echo 매주 일요일 03:00에 점검하여 3개월(90일) 경과 시 자동으로 최신 데이터를 재수집하고 대시보드를 갱신합니다.
) else (
    echo.
    echo [주의] 관리자 권한이 필요할 수 있습니다. 마우스 우클릭 - '관리자 권한으로 실행' 해주세요.
)

echo.
pause
