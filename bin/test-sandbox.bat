@echo off
echo Writing test file...
mkdir C:\tmp\wm 2>nul
echo TEST_VALUE> C:\tmp\wm\VAL
echo Running container...
docker run --rm -v C:\tmp\wm:/w:ro -e MY_VAR_FILE=/w/VAL --entrypoint /bin/bash ghcr.io/jarod-rosenthal/worker -c "export MY_VAR=$(cat /w/VAL); echo MY_VAR=$MY_VAR"
pause
