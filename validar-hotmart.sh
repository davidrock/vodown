#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -x .venv/bin/python ]] || ! .venv/bin/python -c 'import Cryptodome' 2>/dev/null; then
  uv sync --cache-dir .local/uv-cache --system-certs
fi
exec .venv/bin/python hotmart_downloader.py validate "$@"
