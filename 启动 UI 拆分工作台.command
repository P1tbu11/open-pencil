#!/bin/zsh
cd "$(dirname "$0")"
export PATH="$PWD/.runtime:$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

url="http://127.0.0.1:1420"

if ! command -v bun >/dev/null 2>&1; then
  echo "找不到 Bun。可安装 https://bun.sh ，或把可执行文件放到项目的 .runtime/bun"
  read -k 1 "?按任意键关闭"
  exit 1
fi

if [ ! -d node_modules ]; then
  bun install --frozen-lockfile || exit 1
fi
if [ ! -f scratch/ui-slice-ocr ] && [ "$(uname)" = Darwin ]; then
  bun run slice:setup || exit 1
fi

if curl -sf -o /dev/null "$url/"; then
  echo "工作台已在运行：$url"
  open "$url"
  exit 0
fi

(
  for _ in {1..80}; do
    if curl -sf -o /dev/null "$url/"; then
      open "$url"
      exit 0
    fi
    sleep 0.5
  done
  echo "编辑器还没就绪，请稍后手动打开 $url"
) &

exec bun run slice:dev
