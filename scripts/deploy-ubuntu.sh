#!/usr/bin/env bash
# Ubuntu 24 production deploy for the engineering hub.
# The critical rule: do NOT overwrite .next while an old server is running.
# The browser can otherwise hold HTML from one build and request chunks from another,
# which presents as "buttons do nothing", "drawer will not close" or "clicking any
# page goes back to login".
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE_NAME="${SERVICE_NAME:-toolkit}"
SERVICE_UNIT="${SERVICE_NAME%.service}.service"
START_CMD="${START_CMD:-}"
STOP_CMD="${STOP_CMD:-}"
DO_BUILD="${DO_BUILD:-1}"

has_systemd_service() {
  # Consume the full listing so an early match cannot break the pipe.
  systemctl list-unit-files --no-legend --no-pager 2>/dev/null |
    TOOLKIT_TARGET_UNIT="$SERVICE_UNIT" awk '$1 == ENVIRON["TOOLKIT_TARGET_UNIT"] { found = 1 } END { exit !found }'
}

stop_service() {
  if [[ -n "${STOP_CMD}" ]]; then
    eval "${STOP_CMD}"
  elif has_systemd_service; then
    sudo systemctl stop "$SERVICE_UNIT"
  else
    echo "未找到 systemd 服务 ${SERVICE_NAME}，也无法自动停止；请在外部先停止旧进程。"
  fi
}

start_service() {
  if [[ -n "${START_CMD}" ]]; then
    eval "${START_CMD}"
  elif has_systemd_service; then
    sudo systemctl start "$SERVICE_UNIT"
  else
    echo "未找到 systemd 服务 ${SERVICE_NAME}。请手动启动：pnpm start --port 3000"
  fi
}

echo "==> 停止旧服务（必须先停，避免 .next 构建产物与旧进程混用）"
stop_service

echo "==> 安装依赖"
pnpm install --frozen-lockfile

if [[ "${DO_BUILD}" == "1" ]]; then
  echo "==> 构建生产包"
  pnpm build
fi

echo "==> 启动新服务"
start_service

echo "==> 完成。请用无痕窗口或强刷（Ctrl/Cmd+Shift+R）验证登录与按钮交互。"
