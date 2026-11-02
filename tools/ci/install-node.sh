#!/usr/bin/env bash
set -euo pipefail
version=$(tr -d '\r\n' < .node-version)
case "$(uname -m)" in arm64|aarch64) arch=arm64;; x86_64) arch=x64;; *) exit 1;; esac
case "$(uname -s)" in Darwin) platform=darwin;; Linux) platform=linux;; *) exit 1;; esac
name="node-v${version}-${platform}-${arch}"
directory="${TMPDIR:-/tmp}/vodown-node"
mkdir -p "$directory"
if [ ! -x "$directory/$name/bin/node" ]; then
  curl -fsSL "https://nodejs.org/dist/v${version}/${name}.tar.gz" -o "$directory/$name.tar.gz"
  curl -fsSL "https://nodejs.org/dist/v${version}/SHASUMS256.txt" -o "$directory/SHASUMS256.txt"
  (cd "$directory" && awk -v file="$name.tar.gz" '$2 == file' SHASUMS256.txt > selected.sha256 && test -s selected.sha256 && shasum -a 256 -c selected.sha256)
  tar -xzf "$directory/$name.tar.gz" -C "$directory"
fi
printf 'export PATH="%s/%s/bin:$PATH"\n' "$directory" "$name" >> "$BASH_ENV"
