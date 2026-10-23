#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if [[ ! -x .venv/bin/python ]]; then
  uv sync --cache-dir .local/uv-cache --system-certs
fi
exec .venv/bin/python whop_downloader.py download --chrome "$@"
