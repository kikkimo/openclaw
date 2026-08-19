import { resolveStateDir } from "openclaw/plugin-sdk/state-paths";
import {
  getCachedSecret,
  initTOTPCache,
  isAuthenticated,
  isLockedOut,
  markAuthenticated,
  recordFailure,
  refreshAuth,
  resolveTOTPConfig,
  verifyToken,
} from "./totp.js";

/**
 * DM 会话的 TOTP 守卫判定。
 *
 * `pass` 表示该消息应继续分发给 agent；其余每一种都要求调用方回复 `reply`
 * 后终止本轮分发——验证码本身不进 agent 会话。
 */
export type TotpGuardDecision =
  | { action: "pass" }
  | { action: "challenge"; reply: string }
  | { action: "verified"; reply: string }
  | { action: "rejected"; reply: string }
  | { action: "locked"; reply: string };

export type TotpGuardInput = {
  /** 当前生效配置，读取 `channels.feishu.totp`。 */
  cfg: Record<string, unknown>;
  senderOpenId: string;
  /** 入站消息文本；`undefined` 视为非验证码内容。 */
  content: string | undefined;
  /** 同一用户的其他身份标识，任一已认证即视为已认证。 */
  altIds?: string[];
  /** 状态目录，默认取 openclaw 状态目录；测试注入临时目录。 */
  stateDir?: string;
};

const TOKEN_PATTERN = /^\d{6}$/;

/**
 * 判定一条 DM 消息在 TOTP 守卫下的处置方式。
 *
 * 未配置 secret 时一律放行，因此启用该扩展不会把尚未设置 TOTP 的用户挡在门外。
 */
export function evaluateTotpGuard({
  cfg,
  senderOpenId,
  content,
  altIds,
  stateDir,
}: TotpGuardInput): TotpGuardDecision {
  const config = resolveTOTPConfig(cfg);
  if (!config.enabled) {
    return { action: "pass" };
  }

  initTOTPCache(stateDir ?? resolveStateDir());
  const secret = getCachedSecret();
  if (!secret) {
    return { action: "pass" };
  }

  const lockout = isLockedOut(senderOpenId, altIds, config);
  if (lockout.locked) {
    const remainingMinutes = Math.ceil(lockout.remainingMs / 60_000);
    return {
      action: "locked",
      reply: `🔒 验证失败次数过多，请 ${remainingMinutes} 分钟后再试。`,
    };
  }

  if (isAuthenticated(senderOpenId, altIds, config)) {
    refreshAuth(senderOpenId, altIds);
    return { action: "pass" };
  }

  const token = (content ?? "").trim();
  if (!TOKEN_PATTERN.test(token)) {
    return { action: "challenge", reply: "🔐 请先发送 6 位动态验证码完成认证。" };
  }

  if (verifyToken(secret.secret, token)) {
    markAuthenticated(senderOpenId, altIds);
    return { action: "verified", reply: "✅ 认证成功，请开始对话。" };
  }

  const failure = recordFailure(senderOpenId, altIds, config);
  const remainingAttempts = failure.max - failure.count;
  if (remainingAttempts <= 0) {
    return {
      action: "rejected",
      reply: `❌ 验证码错误，已达尝试上限，请 ${config.lockoutMinutes} 分钟后再试。`,
    };
  }
  return {
    action: "rejected",
    reply: `❌ 验证码错误，还可尝试 ${remainingAttempts} 次。`,
  };
}
