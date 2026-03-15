#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Python 3 was not found."
  echo "Install Python, then run this launcher again."
  read -r -p "Press Enter to close..."
  exit 1
fi

"$PYTHON_BIN" -m babel_breaker_app --gui
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo
  echo "Babel Breaker GUI failed to start."
  read -r -p "Press Enter to close..."
fi

exit "$STATUS"
