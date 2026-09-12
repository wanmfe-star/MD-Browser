#!/bin/bash
# MD Browser 启动脚本（无需安装 Node）
cd "$(dirname "$0")"
exec ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . "$@"
