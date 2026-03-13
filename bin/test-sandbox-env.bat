@echo off
mkdir C:\tmp\wm-test 2>nul
echo [{"name":"typecheck","commands":["uv run mypy src"]}]> C:\tmp\wm-test\QGC
docker run --rm -v C:\tmp\wm-test:/tmp/wm:ro -e QUALITY_GATE_COMMANDS_FILE=/tmp/wm/QGC --entrypoint /bin/bash ghcr.io/jarod-rosenthal/worker -c "source /app/epic-entrypoint.sh 2>/dev/null; echo RESULT=$QUALITY_GATE_COMMANDS" 2>&1
pause
