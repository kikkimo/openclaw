import * as fs from "node:fs";
import * as path from "node:path";
import * as otpauth from "otpauth";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateSecret,
  loadSecret,
  saveSecret,
  deleteSecret,
  verifyToken,
  initTOTPCache,
  getCachedSecret,
  invalidateCache,
  isAuthenticated,
  markAuthenticated,
  isLockedOut,
  recordFailure,
  resolveTOTPConfig,
  getTOTPConfig,
  resetTOTPState,
  flushAuthState,
  refreshAuth,
} from "./totp.js";

describe("totp", () => {
  let tempDir: string;
  let stateDir: string;

  beforeEach(() => {
    // 创建临时目录用于测试
    tempDir = `D:/claude-integrated/openclaw-workspace/temp-test-${Date.now()}`;
    stateDir = path.join(tempDir, "state");
    fs.mkdirSync(stateDir, { recursive: true });

    // 重置模块状态
    if (typeof resetTOTPState === "function") {
      resetTOTPState();
    }

    // 重置配置为默认值
    resolveTOTPConfig({});
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    // 重置模块状态
    if (typeof resetTOTPState === "function") {
      resetTOTPState();
    }

    // 重置配置为默认值
    resolveTOTPConfig({});

    // 恢复 Date.now mock
    vi.restoreAllMocks();
  });

  describe("generateSecret", () => {
    it("should generate a valid secret", () => {
      const result = generateSecret();
      expect(result.secret).toMatch(/^[A-Z2-7]+=*$/);
      expect(result.secret.length).toBeGreaterThanOrEqual(32);
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    });
  });

  describe("saveSecret / loadSecret", () => {
    it("should save and load secret data", () => {
      const secretData = {
        issuer: "OpenClaw",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      };

      saveSecret(stateDir, secretData);
      const loaded = loadSecret(stateDir);

      expect(loaded).toEqual(secretData);
    });

    it("should return null when secret file does not exist", () => {
      const loaded = loadSecret(stateDir);
      expect(loaded).toBeNull();
    });

    it("should return null for corrupted secret file", () => {
      const secretsPath = path.join(stateDir, "totp", "secrets.json");
      fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
      fs.writeFileSync(secretsPath, "invalid json");

      const loaded = loadSecret(stateDir);
      expect(loaded).toBeNull();
    });
  });

  describe("deleteSecret", () => {
    it("should delete existing secret", () => {
      const secretData = {
        issuer: "OpenClaw",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      };

      saveSecret(stateDir, secretData);
      const deleted = deleteSecret(stateDir);

      expect(deleted).toBe(true);
      expect(loadSecret(stateDir)).toBeNull();
    });

    it("should return false when secret file does not exist", () => {
      const deleted = deleteSecret(stateDir);
      expect(deleted).toBe(false);
    });
  });

  describe("verifyToken", () => {
    it("should validate correct TOTP token", () => {
      // 使用固定的 secret 生成已知的 token
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成当前时间的 token
      const token = totp.generate();
      expect(verifyToken(secret, token)).toBe(true);
    });

    it("should reject incorrect TOTP token", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      expect(verifyToken(secret, "000000")).toBe(false);
    });

    it("should accept token from previous window (window=1)", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成 30 秒前的 token
      const timestamp = Date.now() - 30000;
      const token = totp.generate({ timestamp });
      expect(verifyToken(secret, token)).toBe(true);
    });
  });

  describe("initTOTPCache / getCachedSecret", () => {
    it("should cache secret after initialization", () => {
      const secretData = {
        issuer: "OpenClaw",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      };

      saveSecret(stateDir, secretData);
      initTOTPCache(stateDir);

      const cached = getCachedSecret();
      expect(cached).toEqual(secretData);
    });

    it("should return null when no secret is cached", () => {
      initTOTPCache(stateDir);
      invalidateCache(); // 清除可能存在的缓存
      const cached = getCachedSecret();
      expect(cached).toBeNull();
    });
  });

  describe("invalidateCache", () => {
    it("should invalidate cached secret", () => {
      const secretData = {
        issuer: "OpenClaw",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      };

      saveSecret(stateDir, secretData);
      initTOTPCache(stateDir);
      const cached1 = getCachedSecret();
      expect(cached1).toEqual(secretData);

      invalidateCache();
      // invalidateCache 将 cachedSecret 设为 undefined
      // 下次调用 getCachedSecret 会从磁盘重新加载
      const cached2 = getCachedSecret();
      expect(cached2).toEqual(secretData);
    });

    it.skip("should reload from disk after cache invalidation", () => {
      // 这个测试需要 resetTOTPState 函数,等实现后再启用
      const secretData = {
        issuer: "OpenClaw",
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      };

      saveSecret(stateDir, secretData);
      initTOTPCache(stateDir);
      expect(getCachedSecret()).toEqual(secretData);

      invalidateCache();
      expect(getCachedSecret()).toEqual(secretData); // 应该从磁盘重新加载
    });
  });

  describe("isAuthenticated / markAuthenticated", () => {
    it("should return false for unauthenticated sender", () => {
      expect(isAuthenticated("user123")).toBe(false);
    });

    it("should mark sender as authenticated", () => {
      markAuthenticated("user123");
      expect(isAuthenticated("user123")).toBe(true);
    });

    it("should expire authentication after timeout", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      markAuthenticated("user123");
      expect(isAuthenticated("user123")).toBe(true);

      // 模拟时间前进 61 分钟 (超过 60 分钟超时)
      vi.spyOn(Date, "now").mockReturnValue(61 * 60 * 1000);
      expect(isAuthenticated("user123")).toBe(false);
    });

    it("should clear failure records on successful authentication", () => {
      // 先记录几次失败
      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures; i++) {
        recordFailure("user123", undefined);
      }

      expect(isLockedOut("user123").locked).toBe(true);

      // 成功认证后应该清除失败记录
      markAuthenticated("user123");
      expect(isLockedOut("user123").locked).toBe(false);
    });
  });

  describe("isLockedOut", () => {
    it("should not lock out before max failures", () => {
      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures - 1; i++) {
        recordFailure("user123", undefined);
      }

      const result = isLockedOut("user123");
      expect(result.locked).toBe(false);
      expect(result.remainingMs).toBe(0);
    });

    it("should lock out after max failures", () => {
      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures; i++) {
        recordFailure("user123", undefined);
      }

      const result = isLockedOut("user123");
      expect(result.locked).toBe(true);
      expect(result.remainingMs).toBeGreaterThan(0);
    });

    it("should unlock after lockout period expires", () => {
      const now = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(now);

      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures; i++) {
        recordFailure("user123", undefined);
      }

      expect(isLockedOut("user123").locked).toBe(true);

      // 模拟时间前进超过锁定时间
      vi.spyOn(Date, "now").mockReturnValue(now + (config.lockoutMinutes + 1) * 60 * 1000 + 1);
      expect(isLockedOut("user123").locked).toBe(false);
    });

    it("should return remainingMs=0 when not locked out", () => {
      const result = isLockedOut("user456");
      expect(result.locked).toBe(false);
      expect(result.remainingMs).toBe(0);
    });
  });

  describe("recordFailure", () => {
    it("should track failure count", () => {
      const result1 = recordFailure("user789", undefined);
      expect(result1.count).toBe(1);

      const result2 = recordFailure("user789", undefined);
      expect(result2.count).toBe(2);

      const result3 = recordFailure("user790", undefined);
      expect(result3.count).toBe(1);
    });

    it("should return max failures from config", () => {
      const config = getTOTPConfig();
      const result = recordFailure("user123", undefined);
      expect(result.max).toBe(config.maxFailures);
    });

    it("should reset failure count after lockout period", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures; i++) {
        recordFailure("user791", undefined);
      }

      expect(isLockedOut("user791").locked).toBe(true);

      // 模拟时间前进超过锁定时间
      vi.spyOn(Date, "now").mockReturnValue((config.lockoutMinutes + 1) * 60 * 1000 + 1);

      // 此时检查锁定状态应该清除失败记录
      expect(isLockedOut("user791").locked).toBe(false);

      // 新的失败应该从 1 开始计数
      const result = recordFailure("user791", undefined);
      expect(result.count).toBe(1);
    });
  });

  describe("resolveTOTPConfig", () => {
    it("should return default config when no config provided", () => {
      const config = resolveTOTPConfig({});
      expect(config).toEqual({
        enabled: true,
        timeoutMinutes: 60,
        maxFailures: 5,
        lockoutMinutes: 10,
      });
    });

    it("should merge provided config with defaults", () => {
      const config = resolveTOTPConfig({
        channels: {
          feishu: {
            totp: {
              enabled: false,
              timeoutMinutes: 120,
              maxFailures: 3,
              lockoutMinutes: 15,
            },
          },
        },
      });

      expect(config).toEqual({
        enabled: false,
        timeoutMinutes: 120,
        maxFailures: 3,
        lockoutMinutes: 15,
      });
    });

    it("should use defaults for missing fields", () => {
      const config = resolveTOTPConfig({
        channels: {
          feishu: {
            totp: {
              timeoutMinutes: 90,
            },
          },
        },
      });

      expect(config).toEqual({
        enabled: true,
        timeoutMinutes: 90,
        maxFailures: 5,
        lockoutMinutes: 10,
      });
    });
  });

  describe("Task 2: altIds support", () => {
    it("should mark authenticated for both primary and alt IDs", () => {
      markAuthenticated("user123", ["alt1", "alt2"]);

      expect(isAuthenticated("user123")).toBe(true);
      expect(isAuthenticated("user123", ["alt1"])).toBe(true);
      expect(isAuthenticated("user123", ["alt2"])).toBe(true);
    });

    it("should check authentication via alt IDs", () => {
      // 只用 alt ID 标记
      markAuthenticated("user123", ["alt1"]);

      // 应该能通过任一 ID 认证
      expect(isAuthenticated("user123", ["alt1"])).toBe(true);
      expect(isAuthenticated("user123", ["alt2", "alt1"])).toBe(true);
    });

    it("should check lockout via alt IDs", () => {
      const config = getTOTPConfig();
      for (let i = 0; i < config.maxFailures; i++) {
        recordFailure("user123", ["alt1"]);
      }

      // 应该能通过任一 ID 检查到锁定
      expect(isLockedOut("user123", ["alt1"]).locked).toBe(true);
      expect(isLockedOut("user123", ["alt2", "alt1"]).locked).toBe(true);
    });

    it("should refresh authentication timeout", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      markAuthenticated("user123");
      expect(isAuthenticated("user123")).toBe(true);

      // 前进 50 分钟
      vi.spyOn(Date, "now").mockReturnValue(50 * 60 * 1000);
      expect(isAuthenticated("user123")).toBe(true);

      // 刷新认证
      refreshAuth("user123");

      // 再前进 50 分钟(总共 100 分钟,应该仍然有效)
      vi.spyOn(Date, "now").mockReturnValue(100 * 60 * 1000);
      expect(isAuthenticated("user123")).toBe(true);
    });

    it("should not refresh authentication for non-existent keys", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      refreshAuth("user999"); // 未认证的用户

      // 前进时间
      vi.spyOn(Date, "now").mockReturnValue(61 * 60 * 1000);
      expect(isAuthenticated("user999")).toBe(false);
    });

    it("should refresh authentication for alt IDs", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      markAuthenticated("user123", ["alt1"]);
      expect(isAuthenticated("user123", ["alt1"])).toBe(true);

      // 前进 50 分钟
      vi.spyOn(Date, "now").mockReturnValue(50 * 60 * 1000);
      expect(isAuthenticated("user123", ["alt1"])).toBe(true);

      // 刷新认证
      refreshAuth("user123", ["alt1"]);

      // 再前进 50 分钟
      vi.spyOn(Date, "now").mockReturnValue(100 * 60 * 1000);
      expect(isAuthenticated("user123", ["alt1"])).toBe(true);
    });
  });

  describe("Task 3: auth state persistence", () => {
    it("should load auth state from disk on init", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      // 创建一个认证状态文件
      const authStatePath = path.join(stateDir, "totp", "auth-state.json");
      fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
      fs.writeFileSync(
        authStatePath,
        JSON.stringify({
          "feishu:user123": 0,
        }),
      );

      // 初始化应该加载状态
      initTOTPCache(stateDir);
      expect(isAuthenticated("user123")).toBe(true);
    });

    it("should flush auth state to disk", async () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      initTOTPCache(stateDir);
      markAuthenticated("user123");
      expect(isAuthenticated("user123")).toBe(true);

      // 立即刷新到磁盘
      await flushAuthState();

      const authStatePath = path.join(stateDir, "totp", "auth-state.json");
      expect(fs.existsSync(authStatePath)).toBe(true);

      const data = JSON.parse(fs.readFileSync(authStatePath, "utf-8"));
      expect(data).toHaveProperty("feishu:user123");
    });

    it("should prune expired entries on load", () => {
      vi.spyOn(Date, "now").mockReturnValue(0);

      // 创建一个包含过期条目的认证状态文件
      const authStatePath = path.join(stateDir, "totp", "auth-state.json");
      fs.mkdirSync(path.dirname(authStatePath), { recursive: true });

      // 2 小时前的条目(已过期)
      const twoHoursAgo = -2 * 60 * 60 * 1000;
      fs.writeFileSync(
        authStatePath,
        JSON.stringify({
          "feishu:oldUser": twoHoursAgo,
        }),
      );

      // 初始化应该跳过过期条目
      initTOTPCache(stateDir);
      expect(isAuthenticated("oldUser")).toBe(false);
    });

    it("should schedule persist on markAuthenticated", async () => {
      vi.useFakeTimers();
      initTOTPCache(stateDir);

      markAuthenticated("user123");

      // 等待 5 秒
      await vi.advanceTimersByTimeAsync(5000);

      const authStatePath = path.join(stateDir, "totp", "auth-state.json");
      expect(fs.existsSync(authStatePath)).toBe(true);

      vi.useRealTimers();
    });

    it("should schedule persist on refreshAuth", async () => {
      vi.useFakeTimers();
      initTOTPCache(stateDir);

      vi.spyOn(Date, "now").mockReturnValue(0);
      markAuthenticated("user123");

      vi.spyOn(Date, "now").mockReturnValue(50 * 60 * 1000);
      refreshAuth("user123");

      // 等待 5 秒
      await vi.advanceTimersByTimeAsync(5000);

      const authStatePath = path.join(stateDir, "totp", "auth-state.json");
      expect(fs.existsSync(authStatePath)).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Task 4: enhanced TOTP verification (window=2)", () => {
    it("should accept codes from counter-2", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成 60 秒前的 token (counter-2)
      const timestamp = Date.now() - 60000;
      const token = totp.generate({ timestamp });

      expect(verifyToken(secret, token)).toBe(true);
    });

    it("should accept codes from counter+2", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成 60 秒后的 token (counter+2)
      const timestamp = Date.now() + 60000;
      const token = totp.generate({ timestamp });

      expect(verifyToken(secret, token)).toBe(true);
    });

    it("should reject codes from counter-3", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成 90 秒前的 token (counter-3)
      const timestamp = Date.now() - 90000;
      const token = totp.generate({ timestamp });

      expect(verifyToken(secret, token)).toBe(false);
    });

    it("should reject codes from counter+3", () => {
      const secret = "JBSWY3DPEHPK3PXP";
      const totp = new otpauth.TOTP({
        issuer: "OpenClaw",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(secret),
      });

      // 生成 90 秒后的 token (counter+3)
      const timestamp = Date.now() + 90000;
      const token = totp.generate({ timestamp });

      expect(verifyToken(secret, token)).toBe(false);
    });
  });
});
