#!/usr/bin/env node
/**
 * TOTP Setup Script
 * Usage: node --import tsx scripts/totp-setup.ts [setup|status|reset]
 */
import readline from "node:readline";
import { resolveStateDir } from "../src/config/paths.js";
import {
  generateSecret,
  loadSecret,
  saveSecret,
  deleteSecret,
  verifyToken,
} from "../extensions/feishu/src/totp.js";

const stateDir = resolveStateDir();
const command = process.argv[2] ?? "setup";

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function setup() {
  const existing = loadSecret(stateDir);
  if (existing) {
    const answer = await ask("TOTP already configured. Regenerate? (y/N): ");
    if (answer.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  const { secret, otpauthUri } = generateSecret();

  console.log("\n=== TOTP Setup ===\n");
  console.log("Scan this QR code with your authenticator app:\n");

  try {
    const qrcode = await import("qrcode-terminal");
    qrcode.default.generate(otpauthUri, { small: true }, (code: string) => {
      console.log(code);
    });
  } catch {
    console.log(`(qrcode-terminal not available, use manual entry)`);
    console.log(`otpauth URI: ${otpauthUri}\n`);
  }

  console.log(`\nManual entry key: ${secret}`);
  console.log("Issuer: OpenClaw");
  console.log("Algorithm: SHA1 | Digits: 6 | Period: 30s\n");

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await ask("Enter verification code to confirm: ");
    if (verifyToken(secret, token.trim())) {
      saveSecret(stateDir, {
        issuer: "OpenClaw",
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        createdAt: new Date().toISOString(),
      });
      console.log("\nTOTP enabled successfully!");
      console.log("Restart Gateway for changes to take effect: openclaw gateway stop && openclaw gateway run");
      return;
    }
    console.log("Incorrect code. Try again.");
  }
  console.log("Setup failed: could not verify. Try again.");
}

function status() {
  const data = loadSecret(stateDir);
  if (!data) {
    console.log("TOTP: not configured");
    console.log("Run: node --import tsx scripts/totp-setup.ts setup");
    return;
  }
  console.log("TOTP: enabled");
  console.log(`Issuer: ${data.issuer}`);
  console.log(`Created: ${data.createdAt}`);
}

async function reset() {
  const answer = await ask("Are you sure you want to disable TOTP? (y/N): ");
  if (answer.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }
  if (deleteSecret(stateDir)) {
    console.log("TOTP disabled and secret deleted.");
    console.log("Restart Gateway for changes to take effect.");
  } else {
    console.log("TOTP was not configured.");
  }
}

switch (command) {
  case "setup":
    await setup();
    break;
  case "status":
    status();
    break;
  case "reset":
    await reset();
    break;
  default:
    console.log("Usage: node --import tsx scripts/totp-setup.ts [setup|status|reset]");
}
