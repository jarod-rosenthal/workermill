#!/bin/bash
mkdir -p /tmp/wm-test
echo '[{"name":"typecheck","commands":["uv run mypy src"]}]' > /tmp/wm-test/QGC
docker run --rm -v /tmp/wm-test:/tmp/wm:ro -e QUALITY_GATE_COMMANDS_FILE=/tmp/wm/QGC --entrypoint /bin/bash ghcr.io/jarod-rosenthal/worker -c 'for f in $(env | grep _FILE= | cut -d= -f1); do b="${f%_FILE}"; p="${!f}"; [ -f "$p" ] && export "$b"="$(cat "$p")" && unset "$f"; done; echo "RESULT=$QUALITY_GATE_COMMANDS"'
