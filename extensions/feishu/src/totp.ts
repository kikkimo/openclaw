import { TOTP, Secret } from "otpauth";
import fs from "node:fs";
import path from "node:path";

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
    timeoutMinutes: typeof totp.timeoutMinutes === "number" ? totp.timeoutMinutes : DEFAULT_CONFIG.timeoutMinutes,
    maxFailures: typeof totp.maxFailures === "number" ? totp.maxFailures : DEFAULT_CONFIG.maxFailures,
    lockoutMinutes: typeof totp.lockoutMinutes === "number" ? totp.lockoutMinutes : DEFAULT_CONFIG.lockoutMinutes,
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
  return totp.validate({ token, window: 1 }) !== null;
}

// ── Auth State (in-memory) ──

const authState = new Map<string, number>();
const failState = new Map<string, FailRecord>();

// Cached secret to avoid file I/O on every message
let cachedSecret: TOTPSecretData | null | undefined;
let cachedStateDir: string | undefined;

let initialized = false;

export function initTOTPCache(stateDir: string): void {
  if (initialized) return;
  initialized = true;
  cachedStateDir = stateDir;
  cachedSecret = loadSecret(stateDir);
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

export function isAuthenticated(senderId: string, config: TOTPAuthConfig = activeConfig): boolean {
  const key = buildAuthKey(senderId);
  const lastVerified = authState.get(key);
  if (lastVerified === undefined) return false;
  const elapsed = Date.now() - lastVerified;
  if (elapsed >= config.timeoutMinutes * 60 * 1000) {
    authState.delete(key);
    return false;
  }
  return true;
}

export function markAuthenticated(senderId: string): void {
  const key = buildAuthKey(senderId);
  authState.set(key, Date.now());
  failState.delete(key);
}

export function isLockedOut(
  senderId: string,
  config: TOTPAuthConfig = activeConfig,
): { locked: boolean; remainingMs: number } {
  const key = buildAuthKey(senderId);
  const record = failState.get(key);
  if (!record) return { locked: false, remainingMs: 0 };

  const windowMs = config.lockoutMinutes * 60 * 1000;
  const elapsed = Date.now() - record.firstFailAt;

  if (elapsed > windowMs) {
    failState.delete(key);
    return { locked: false, remainingMs: 0 };
  }

  if (record.count >= config.maxFailures) {
    return { locked: true, remainingMs: windowMs - elapsed };
  }

  return { locked: false, remainingMs: 0 };
}

export function recordFailure(
  senderId: string,
  config: TOTPAuthConfig = activeConfig,
): { count: number; max: number } {
  const key = buildAuthKey(senderId);
  const record = failState.get(key);
  if (!record) {
    failState.set(key, { count: 1, firstFailAt: Date.now() });
    return { count: 1, max: config.maxFailures };
  }
  record.count++;
  return { count: record.count, max: config.maxFailures };
}
