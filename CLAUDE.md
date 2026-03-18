# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**详细仓库规范见 AGENTS.md**（编码风格、PR 流程、安全策略、发布流程等均在此）。

## 运行时路径

- **配置文件**: `C:/Users/Administrator/.openclaw/openclaw.json`
- **Workspace 目录**: `D:/claude-integrated/openclaw-workspace`（独立 git 仓库）
  - 当用户说"操作 workspace"时，指的是对这个独立仓库的操作（读写文件、git 提交等），而非本项目仓库

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm build                # 完整构建（A2UI + tsdown + plugin-sdk DTS + CLI 元数据）
pnpm check                # 质量门禁：format + tsc + oxlint + 自定义规则
pnpm format:fix           # oxfmt 格式化
pnpm lint:fix             # oxlint 自动修复 + 格式化
pnpm test                 # 全量单元测试（vitest，并行）
pnpm test:fast            # 快速测试（排除 gateway/agents/browser）
pnpm test -- <pattern>    # 针对性测试，如 pnpm test -- src/config/
pnpm test:gateway         # Gateway 测试
pnpm test:e2e             # E2E 测试
pnpm test:coverage        # V8 覆盖率（70% 阈值）
pnpm dev                  # 开发模式（自动重载）
pnpm gateway:watch        # Gateway watch 模式
```

## 架构概览

**本地优先的多渠道 AI 助手**，通过单一 gateway 控制面连接 20+ 消息平台。

- **`src/gateway/`** — WebSocket 控制面（会话、通道、工具、事件路由）
- **`src/channels/`** — 核心通道插件（部分平台在 extensions/ 中）
- **`src/agents/`** — Agent 运行时（Pi 集成、工具、技能、沙箱）
- **`src/providers/`** — LLM 提供商集成（OpenAI、Anthropic 等）
- **`src/plugin-sdk/`** — 插件公共 API（50+ 导出模块，供 extensions 使用）
- **`src/cli/`** + **`src/commands/`** — CLI 命令入口
- **`src/config/`** — 配置 schema 与校验
- **`src/infra/`** — 基础设施（状态存储、迁移、设备身份、更新）
- **`extensions/`** — 40+ 插件扩展（pnpm workspace 包，各自独立 `package.json`）
- **`ui/`** — Web 控制面板（Lit 组件）

## 关键约定

- **TypeScript ESM strict**：禁止 `@ts-nocheck`，`no-explicit-any` 为 error
- **Extension 依赖**：插件专有依赖放 extension 自己的 `package.json`；`openclaw` 放 `peerDependencies`，不用 `workspace:*`
- **动态导入**：创建 `*.runtime.ts` 边界文件，不要混用静态/动态导入同一模块
- **文件大小**：单文件不超 500 行，超 ~700 行应拆分
- **测试**：`*.test.ts` 与源码同目录；E2E 用 `*.e2e.test.ts`；Live 用 `*.live.test.ts`
- **命名**：产品/文档用 **OpenClaw**（大写 O），CLI/包名/路径用 `openclaw`
- **CLI 进度**：用 `src/cli/progress.ts`，不要手写 spinner
- **构建工具**：tsdown 编译、oxlint 检查、oxfmt 格式化、vitest 测试
