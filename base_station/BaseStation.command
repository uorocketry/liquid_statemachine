#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
if ! command -v uv >/dev/null 2>&1; then
  echo "uv is not installed or not on PATH. Install it from https://docs.astral.sh/uv/getting-started/installation/"
  read -p "Press Return to close."
  exit 1
fi
uv run main.py
status=$?
if [ $status -ne 0 ]; then
  echo "Base Station exited with status $status"
fi
read -p "Press Return to close."
exit $status