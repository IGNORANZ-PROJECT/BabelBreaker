#!/bin/bash

set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

RUNTIME_DIR="$SCRIPT_DIR/.babel_breaker_runtime"
UV_HOME="$RUNTIME_DIR/uv"
UV_BIN="$UV_HOME/uv"
UV_CACHE_DIR="$RUNTIME_DIR/cache"
UV_PYTHON_INSTALL_DIR="$RUNTIME_DIR/python"
VENV_DIR="$SCRIPT_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
REQUIREMENTS_FILE="$SCRIPT_DIR/requirements-launcher.txt"

mkdir -p "$RUNTIME_DIR" "$UV_HOME" "$UV_CACHE_DIR" "$UV_PYTHON_INSTALL_DIR"

pause_and_exit() {
  local message="$1"
  local code="${2:-1}"
  echo
  echo "$message"
  read -r -p "Press Enter to close..."
  exit "$code"
}

install_uv() {
  if [ -x "$UV_BIN" ]; then
    return 0
  fi

  echo "Installing local uv runtime..."

  if command -v curl >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$UV_HOME" sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://astral.sh/uv/install.sh | env UV_UNMANAGED_INSTALL="$UV_HOME" sh
  else
    echo "curl or wget is required for the first launch."
    return 1
  fi

  [ -x "$UV_BIN" ]
}

create_or_repair_venv() {
  local -a args
  args=(venv "$VENV_DIR" --python 3.12 --managed-python --relocatable)

  if [ -d "$VENV_DIR" ]; then
    args+=(--clear)
  fi

  "$UV_BIN" "${args[@]}"
}

export UV_CACHE_DIR
export UV_PYTHON_INSTALL_DIR
export UV_PYTHON_NO_REGISTRY=1

if ! install_uv; then
  pause_and_exit "Failed to install the local uv runtime."
fi

if [ ! -x "$VENV_PYTHON" ]; then
  echo "Preparing local Python environment..."
  if ! create_or_repair_venv; then
    pause_and_exit "Failed to prepare the local Python runtime."
  fi
fi

echo "Installing or refreshing launcher dependencies..."
if ! "$UV_BIN" pip install --python "$VENV_DIR" -r "$REQUIREMENTS_FILE"; then
  pause_and_exit "Failed to install the launcher dependencies."
fi

"$VENV_PYTHON" -m babel_breaker_app --gui
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  pause_and_exit "Babel Breaker GUI failed to start." "$STATUS"
fi

exit 0
