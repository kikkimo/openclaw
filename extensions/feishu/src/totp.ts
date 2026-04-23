import fs from "node:fs";
import path from "node:path";
import { TOTP, Secret } from "otpauth";

// ── Types ──

export type TOTPSecretData = {
  issuer: string;
  secret: string;
  algorithm: string;
  digits: number;
  period: number;
  createdAt: string;
};

export type TOTPAuthConfig = {
  enabled: boolean;
  timeoutMinutes: number;
  maxFailures: number;
  lockoutMinutes: number;
};

type FailRecord = { count: number; firstFailAt: number };

// ── Config ──

const DEFAULT_CONFIG: TOTPAuthConfig = {
  enabled: true,
  timeoutMinutes: 60,
  maxFailures: 5,
  lockoutMinutes: 10,
};

let activeConfig: TOTPAuthConfig = { ...DEFAULT_CONFIG };

export function getTOTPConfig(): TOTPAuthConfig {
  return activeConfig;
}

/**
 * Resolve TOTP config from openclaw.json `channels.feishu.totp` block.
 * Example config:
 * {
 *   channels: {
 *     feishu: {
 *       totp: {
 *         enabled: true,
 *         timeoutMinutes: 60,
 *         maxFailures: 5,
 *         lockoutMinutes: 10
 *       }
 *     }
 *   }
 * }
 */
export function resolveTOTPConfig(cfg: Record<string, unknown>): TOTPAuthConfig {
  const channels = cfg?.channels as Record<string, unknown> | undefined;
  const feishu = channels?.feishu as Record<string, unknown> | undefined;
  const totp = feishu?.totp as Record<string, unknown> | undefined;

  if (!totp) return { ...DEFAULT_CONFIG };

  activeConfig = {
    enabled: totp.enabled !== false,
    timeoutMinutes:
      typeof totp.timeoutMinutes === "number" ? totp.timeoutMinutes : DEFAULT_CONFIG.timeoutMinutes,
    maxFailures:
      typeof totp.maxFailures === "number" ? totp.maxFailures : DEFAULT_CONFIG.maxFailures,
    lockoutMinutes:
      typeof totp.lockoutMinutes === "number" ? totp.lockoutMinutes : DEFAULT_CONFIG.lockoutMinutes,
  };
  return activeConfig;
}

// ── Secret Storage ──

const TOTP_DIR = "totp";
const SECRETS_FILE = "secrets.json";

function resolveSecretsPath(stateDir: string): string {
  return path.join(stateDir, TOTP_DIR, SECRETS_FILE);
}

export function loadSecret(stateDir: string): TOTPSecretData | null {
  const filePath = resolveSecretsPath(stateDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

export function saveSecret(stateDir: string, data: TOTPSecretData): void {
  const dir = path.join(stateDir, TOTP_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = resolveSecretsPath(stateDir);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may not support chmod, ignore
  }
}

export function deleteSecret(stateDir: string): boolean {
  const filePath = resolveSecretsPath(stateDir);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export function generateSecret(): { secret: string; otpauthUri: string } {
  const secretObj = new Secret({ size: 20 });
  const totp = new TOTP({
    issuer: "OpenClaw",
    label: "OpenClaw",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: secretObj,
  });
  return { secret: secretObj.base32, otpauthUri: totp.toString() };
}

export function verifyToken(secretBase32: string, token: string): boolean {
  const totp = new TOTP({
    issuer: "OpenClaw",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  });

  const result = totp.validate({ token, window: 2 });

  if (result === null) {
    // 诊断日志:验证失败时输出详细信息
    const serverCounter = Math.floor(Date.now() / 1000 / 30);
    const serverTime = new Date().toISOString();
    const serverCode = totp.generate();

    console.error(
      `[TOTP] 验证失败: serverCounter=${serverCounter}, serverCode=${serverCode}, gotCode=${token}, serverTime=${serverTime}`,
    );
  }

  return result !== null;
}

// ── Auth State (in-memory) ──

const authState = new Map<string, number>();
const failState = new Map<string, FailRecord>();

// Auth state persistence
const AUTH_STATE_FILE = "auth-state.json";
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;

// Cached secret to avoid file I/O on every message
let cachedSecret: TOTPSecretData | null | undefined;
let cachedStateDir: string | undefined;

let initialized = false;

export function initTOTPCache(stateDir: string): void {
  if (initialized) return;
  initialized = true;
  cachedStateDir = stateDir;
  cachedSecret = loadSecret(stateDir);
  loadAuthState(stateDir);
}

// ── Auth State Persistence ──

function resolveAuthStatePath(stateDir: string): string {
  return path.join(stateDir, TOTP_DIR, AUTH_STATE_FILE);
}

/**
 * 清理已过期的认证条目
 */
function pruneExpiredEntries(): void {
  const config = activeConfig;
  const now = Date.now();
  const timeoutMs = config.timeoutMinutes * 60 * 1000;

  for (const [key, timestamp] of authState.entries()) {
    if (now - timestamp >= timeoutMs) {
      authState.delete(key);
    }
  }
}

/**
 * 从磁盘加载认证状态
 */
function loadAuthState(stateDir: string): void {
  const filePath = resolveAuthStatePath(stateDir);
  if (!fs.existsSync(filePath)) return;

  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, number>;
    const config = activeConfig;
    const now = Date.now();
    const timeoutMs = config.timeoutMinutes * 60 * 1000;

    // 只加载未过期的条目
    for (const [key, timestamp] of Object.entries(data)) {
      if (now - timestamp < timeoutMs) {
        authState.set(key, timestamp);
      }
    }
  } catch {
    // 忽略解析错误
  }
}

/**
 * 将认证状态写入磁盘
 */
function writeAuthState(stateDir: string): void {
  const filePath = resolveAuthStatePath(stateDir);
  const dir = path.dirname(filePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // 先清理过期条目
  pruneExpiredEntries();

  // 转换为普通对象
  const data = Object.fromEntries(authState);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may not support chmod, ignore
  }

  persistDirty = false;
}

/**
 * 调度持久化写入(防抖,5秒延迟)
 */
function schedulePersist(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  persistDirty = true;

  persistTimer = setTimeout(() => {
    if (persistDirty && cachedStateDir) {
      writeAuthState(cachedStateDir);
    }
    persistTimer = null;
  }, 5000);
}

/**
 * 立即刷新认证状态到磁盘
 */
export function flushAuthState(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }

    if (persistDirty && cachedStateDir) {
      try {
        writeAuthState(cachedStateDir);
        resolve();
      } catch (error) {
        reject(error);
      }
    } else {
      resolve();
    }
  });
}

/**
 * 重置所有模块状态(仅用于测试)
 */
export function resetTOTPState(): void {
  authState.clear();
  failState.clear();
  cachedSecret = undefined;
  cachedStateDir = undefined;
  initialized = false;

  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistDirty = false;
}

export function getCachedSecret(): TOTPSecretData | null {
  if (cachedSecret === undefined && cachedStateDir) {
    cachedSecret = loadSecret(cachedStateDir);
  }
  return cachedSecret ?? null;
}

export function invalidateCache(): void {
  cachedSecret = undefined;
}

function buildAuthKey(senderId: string): string {
  return `feishu:${senderId}`;
}

function buildAuthKeys(senderId: string, altIds?: string[]): string[] {
  const keys = [`feishu:${senderId}`];
  if (altIds && altIds.length > 0) {
    for (const id of altIds) {
      const key = `feishu:${id}`;
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

export function isAuthenticated(
  senderId: string,
  altIds?: string[],
  config: TOTPAuthConfig = activeConfig,
): boolean {
  const keys = buildAuthKeys(senderId, altIds);
  const now = Date.now();
  const timeoutMs = config.timeoutMinutes * 60 * 1000;

  for (const key of keys) {
    const lastVerified = authState.get(key);
    if (lastVerified !== undefined) {
      const elapsed = now - lastVerified;
      if (elapsed < timeoutMs) {
        return true; // 任一 key 有效即认为已认证
      } else {
        // 清理过期的认证状态
        authState.delete(key);
      }
    }
  }
  return false;
}

export function markAuthenticated(senderId: string, altIds?: string[]): void {
  const keys = buildAuthKeys(senderId, altIds);
  const now = Date.now();

  for (const key of keys) {
    authState.set(key, now);
    // 只清除主 key 的失败记录
    if (key === buildAuthKey(senderId)) {
      failState.delete(key);
    }
  }

  schedulePersist();
}

/**
 * 刷新认证时间戳(仅针对已认证的 key)
 * 用于滑动窗口刷新认证超时时间
 */
export function refreshAuth(senderId: string, altIds?: string[]): void {
  const keys = buildAuthKeys(senderId, altIds);
  const now = Date.now();

  let refreshed = false;
  for (const key of keys) {
    // 只刷新已存在的认证状态
    if (authState.has(key)) {
      authState.set(key, now);
      refreshed = true;
    }
  }

  if (refreshed) {
    schedulePersist();
  }
}

export function isLockedOut(
  senderId: string,
  altIds?: string[],
  config: TOTPAuthConfig = activeConfig,
): { locked: boolean; remainingMs: number } {
  const keys = buildAuthKeys(senderId, altIds);
  const windowMs = config.lockoutMinutes * 60 * 1000;
  const now = Date.now();

  for (const key of keys) {
    const record = failState.get(key);
    if (!record) continue;

    const elapsed = now - record.firstFailAt;

    if (elapsed > windowMs) {
      failState.delete(key);
      continue;
    }

    if (record.count >= config.maxFailures) {
      return { locked: true, remainingMs: windowMs - elapsed };
    }
  }

  return { locked: false, remainingMs: 0 };
}

export function recordFailure(
  senderId: string,
  altIds: string[] | undefined,
  config: TOTPAuthConfig = activeConfig,
): { count: number; max: number } {
  // 只针对主 key 记录失败
  const key = buildAuthKey(senderId);
  const record = failState.get(key);
  if (!record) {
    failState.set(key, { count: 1, firstFailAt: Date.now() });
    return { count: 1, max: config.maxFailures };
  }
  record.count++;
  return { count: record.count, max: config.maxFailures };
}
