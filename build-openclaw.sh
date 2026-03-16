#!/usr/bin/env bash
# OpenClaw 一站式构建、安装和运行脚本
#
# 用法:
#   bash build-openclaw.sh              # 标准构建（修改代码后推荐）
#   bash build-openclaw.sh --quick      # 最小构建（仅 tsdown，最快）
#   bash build-openclaw.sh --full       # 完整构建（含 canvas/a2ui，需全局 tsc）
#   bash build-openclaw.sh --setup      # 首次安装：构建 + npm link + 注册开机自启
#   bash build-openclaw.sh --restart    # 构建 + 重启 Gateway
#   bash build-openclaw.sh --run        # 构建 + 前台运行 Gateway（开发调试用）
#   bash build-openclaw.sh --status     # 查看 Gateway 运行状态
#   bash build-openclaw.sh --stop       # 停止 Gateway

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

MODE="${1:-standard}"

# ── 辅助函数 ──

build_quick() {
  node scripts/tsdown-build.mjs
  node scripts/runtime-postbuild.mjs
}

build_standard() {
  build_quick
  (cd ui && npx vite build) 2>/dev/null || echo "    (UI 构建跳过)"
  pnpm build:plugin-sdk:dts 2>/dev/null || echo "    (plugin SDK dts 跳过)"
  node --import tsx scripts/write-build-info.ts 2>/dev/null || true
  node --import tsx scripts/write-cli-startup-metadata.ts 2>/dev/null || true
}

verify_cli() {
  VERSION=$(openclaw --version 2>&1) || {
    echo "错误: openclaw CLI 不在 PATH 中"
    echo "运行: bash build-openclaw.sh --setup"
    exit 1
  }
  echo "    $VERSION"
  echo "    CLI: $(which openclaw)"
}

find_gateway_pid() {
  netstat -ano 2>/dev/null | grep "18789.*LISTEN" | head -1 | awk '{print $NF}'
}

stop_gateway() {
  local pid
  pid=$(find_gateway_pid)
  if [[ -n "$pid" ]]; then
    taskkill //F //PID "$pid" > /dev/null 2>&1 && echo "    Gateway 已停止 (PID $pid)" || true
    sleep 2
  else
    echo "    Gateway 未运行"
  fi
}

patch_gateway_cmd() {
  # 确保 gateway.cmd 启动前自动编译
  local cmd_file="${USERPROFILE:-$HOME}/.openclaw/gateway.cmd"
  if [[ -f "$cmd_file" ]] && ! grep -q "tsdown-build" "$cmd_file" 2>/dev/null; then
    sed -i "s|\"C:\\\\Program Files\\\\nodejs\\\\node.exe\" D:\\\\claude-integrated\\\\openclaw\\\\dist\\\\index.js|cd /d D:\\\\claude-integrated\\\\openclaw\nrem Auto-build\n\"C:\\\\Program Files\\\\nodejs\\\\node.exe\" scripts\\\\tsdown-build.mjs\n\"C:\\\\Program Files\\\\nodejs\\\\node.exe\" scripts\\\\runtime-postbuild.mjs\nrem Start gateway\n\"C:\\\\Program Files\\\\nodejs\\\\node.exe\" D:\\\\claude-integrated\\\\openclaw\\\\dist\\\\index.js|" "$cmd_file"
    echo "    gateway.cmd 已添加自动编译步骤"
  fi
}

# ── 主逻辑 ──

case "$MODE" in
  --status)
    echo "=== OpenClaw Gateway 状态 ==="
    pid=$(find_gateway_pid)
    if [[ -n "$pid" ]]; then
      echo "    运行中 (PID $pid, 端口 18789)"
      curl -s http://127.0.0.1:18789/healthz 2>/dev/null && echo "" || echo "    健康检查无响应"
    else
      echo "    未运行"
    fi
    exit 0
    ;;

  --stop)
    echo "=== 停止 Gateway ==="
    stop_gateway
    exit 0
    ;;

  --quick)
    echo "=== 最小构建 ==="
    echo "    Node: $(node --version)"
    echo ""
    build_quick
    ;;

  --full)
    echo "=== 完整构建 ==="
    echo "    Node: $(node --version)"
    echo ""
    pnpm build
    ;;

  --setup)
    echo "=== 首次安装 ==="
    echo "    Node: $(node --version)"
    echo ""

    # 1. 安装依赖（如需要）
    if [[ ! -d "node_modules" ]]; then
      echo "--- 安装依赖 ---"
      pnpm install
    fi

    # 2. 标准构建
    echo "--- 构建 ---"
    build_standard

    # 3. 全局链接
    echo ""
    echo "--- 全局链接 ---"
    npm link
    verify_cli

    # 4. 注册开机自启
    echo ""
    echo "--- 注册开机自启 ---"
    openclaw gateway install 2>&1 | tail -3

    # 5. 修补 gateway.cmd 加入自动编译
    patch_gateway_cmd

    # 6. 取消 72 小时超时限制
    powershell.exe -NoProfile -Command 'Set-ScheduledTask -TaskName "OpenClaw Gateway" -Settings (New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Days 0))' > /dev/null 2>&1 \
      && echo "    已取消执行时间限制" || echo "    (取消超时限制失败，请手动设置)"

    echo ""
    echo "=== 安装完成 ==="
    verify_cli
    echo "    开机自启: 已注册"
    echo ""
    echo "运行 'openclaw gateway run' 或 'bash build-openclaw.sh --run' 启动"
    exit 0
    ;;

  --restart)
    echo "=== 构建并重启 Gateway ==="
    echo "    Node: $(node --version)"
    echo ""
    build_standard
    echo ""
    echo "--- 重启 Gateway ---"
    stop_gateway
    cd "$SCRIPT_DIR"
    local logfile="/tmp/openclaw-gateway-start.log"
    node openclaw.mjs gateway run > "$logfile" 2>&1 &
    disown
    echo "    等待 Gateway 启动..."
    for i in $(seq 1 15); do
      if curl -s http://127.0.0.1:18789/healthz > /dev/null 2>&1; then
        pid=$(find_gateway_pid)
        echo "    Gateway 已启动 (PID $pid)"
        break
      fi
      sleep 2
    done
    if ! curl -s http://127.0.0.1:18789/healthz > /dev/null 2>&1; then
      echo "    Gateway 启动失败，最近日志:"
      tail -10 "$logfile" 2>/dev/null
      exit 1
    fi
    ;;

  --run)
    echo "=== 构建并前台运行 Gateway ==="
    echo "    Node: $(node --version)"
    echo ""
    build_standard
    echo ""
    echo "--- 启动 Gateway (Ctrl+C 停止) ---"
    exec pnpm dev gateway run
    ;;

  *)
    echo "=== 标准构建 ==="
    echo "    Node: $(node --version)"
    echo ""
    build_standard
    ;;
esac

echo ""
echo "=== 完成 ==="
verify_cli
