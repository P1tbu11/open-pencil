#!/bin/zsh
cd "$(dirname "$0")"
export PATH="$PWD/.runtime:$PATH"
if ! command -v bun >/dev/null 2>&1; then
  echo '请先安装 Bun：https://bun.sh'
  exit 1
fi
if [ ! -d node_modules ]; then bun install --frozen-lockfile; fi
if [ ! -f scratch/ui-slice-ocr ] && [ "$(uname)" = Darwin ]; then bun run slice:setup; fi
bun run slice:dev
