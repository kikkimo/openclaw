import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Secret, TOTP } from "otpauth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateTotpGuard } from "./totp-guard.js";
import { resetTOTPState, saveSecret, type TOTPSecretData } from "./totp.js";

const SENDER = "ou_guard_primary";
const ALT_SENDER = "ou_guard_alt";

// macOS 的 os.tmpdir() 是 /var -> /private/var 符号链接，生产代码返回规范化路径，
// 故先 realpath，避免测试仅在 Linux CI 通过。
function makeStateDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-totp-guard-")));
}

function buildSecretData(secretBase32: string): TOTPSecretData {
  return {
    issuer: "OpenClaw",
    secret: secretBase32,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    createdAt: new Date(0).toISOString(),
  };
}

function currentToken(secretBase32: string): string {
  return new TOTP({
    secret: Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).generate();
}

function cfgWithTotp(totp?: Record<string, unknown>): Record<string, unknown> {
  return { channels: { feishu: totp === undefined ? {} : { totp } } };
}

describe("evaluateTotpGuard", () => {
  let stateDir: string;
  let secretBase32: string;

  beforeEach(() => {
    resetTOTPState();
    stateDir = makeStateDir();
    secretBase32 = new Secret({ size: 20 }).base32;
  });

  afterEach(() => {
    resetTOTPState();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  const seedSecret = () => saveSecret(stateDir, buildSecretData(secretBase32));

  const evaluate = (content: string | undefined, cfg = cfgWithTotp(), altIds?: string[]) =>
    evaluateTotpGuard({ cfg, senderOpenId: SENDER, content, altIds, stateDir });

  describe("放行条件", () => {
    it("配置显式关闭时直接放行", () => {
      seedSecret();
      expect(evaluate("hello", cfgWithTotp({ enabled: false }))).toEqual({ action: "pass" });
    });

    it("未配置 secret 时放行，不应拦住尚未启用 TOTP 的用户", () => {
      expect(evaluate("hello")).toEqual({ action: "pass" });
    });

    it("已认证的发送者放行", () => {
      seedSecret();
      const verified = evaluate(currentToken(secretBase32));
      expect(verified.action).toBe("verified");
      expect(evaluate("正常对话内容")).toEqual({ action: "pass" });
    });
  });

  describe("挑战与验证", () => {
    it("未认证且内容不是 6 位数字时要求验证码", () => {
      seedSecret();
      const decision = evaluate("帮我查一下天气");
      expect(decision.action).toBe("challenge");
      expect(decision).toHaveProperty("reply");
    });

    it("content 为 undefined 时同样要求验证码而非崩溃", () => {
      seedSecret();
      expect(evaluate(undefined).action).toBe("challenge");
    });

    it("正确验证码返回 verified，且该条消息不应继续分发给 agent", () => {
      seedSecret();
      const decision = evaluate(currentToken(secretBase32));
      expect(decision.action).toBe("verified");
      // verified 不等于 pass：调用方必须回复后终止，验证码本身不进 agent
      expect(decision.action).not.toBe("pass");
    });

    it("非 6 位的纯数字不被当作验证码", () => {
      seedSecret();
      expect(evaluate("12345").action).toBe("challenge");
      expect(evaluate("1234567").action).toBe("challenge");
    });

    it("验证码两侧空白被容忍", () => {
      seedSecret();
      expect(evaluate(`  ${currentToken(secretBase32)}  `).action).toBe("verified");
    });
  });

  describe("失败与锁定", () => {
    it("错误验证码返回 rejected 并告知剩余次数", () => {
      seedSecret();
      const decision = evaluate("000000", cfgWithTotp({ maxFailures: 3 }));
      expect(decision.action).toBe("rejected");
      expect(decision).toHaveProperty("reply");
      if (decision.action === "rejected") {
        expect(decision.reply).toContain("2");
      }
    });

    it("达到最大失败次数后转为锁定", () => {
      seedSecret();
      const cfg = cfgWithTotp({ maxFailures: 2, lockoutMinutes: 10 });
      expect(evaluate("000000", cfg).action).toBe("rejected");
      expect(evaluate("000000", cfg).action).toBe("rejected");
      const locked = evaluate("000000", cfg);
      expect(locked.action).toBe("locked");
      if (locked.action === "locked") {
        expect(locked.reply).toContain("分钟");
      }
    });

    it("锁定期内即使提交正确验证码也不放行", () => {
      seedSecret();
      const cfg = cfgWithTotp({ maxFailures: 1, lockoutMinutes: 10 });
      expect(evaluate("000000", cfg).action).toBe("rejected");
      expect(evaluate(currentToken(secretBase32), cfg).action).toBe("locked");
    });

    // 「成功认证清除失败计数」由 totp.test.ts 覆盖（recordFailure/markAuthenticated 层），
    // 此处不重复。
  });

  describe("altIds", () => {
    it("通过 altId 完成的认证对主 id 生效", () => {
      seedSecret();
      const viaAlt = evaluateTotpGuard({
        cfg: cfgWithTotp(),
        senderOpenId: ALT_SENDER,
        content: currentToken(secretBase32),
        altIds: [SENDER],
        stateDir,
      });
      expect(viaAlt.action).toBe("verified");
      expect(
        evaluateTotpGuard({
          cfg: cfgWithTotp(),
          senderOpenId: ALT_SENDER,
          content: "后续对话",
          altIds: [SENDER],
          stateDir,
        }),
      ).toEqual({ action: "pass" });
    });
  });

  describe("配置隔离", () => {
    it("不带 totp 段的配置不应继承上一次调用设置的严格上限", () => {
      seedSecret();
      // 先用 maxFailures=1 触发一次失败，使模块内配置被写为严格值
      expect(evaluate("000000", cfgWithTotp({ maxFailures: 1 })).action).toBe("rejected");
      resetTOTPState();
      seedSecret();
      // 再用不含 totp 段的配置：应回落到默认 maxFailures(5)，而不是沿用 1
      const decision = evaluate("000000", cfgWithTotp());
      expect(decision.action).toBe("rejected");
      if (decision.action === "rejected") {
        expect(decision.reply).toContain("4");
      }
    });
  });
});
