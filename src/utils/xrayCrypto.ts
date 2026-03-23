// src/utils/xrayCrypto.ts
import { runCommand } from './shell.js';
import { randomBytes, createHash } from 'crypto';
import { logger } from './logger.js';

/**
 * Xray 密钥/ID 生成工具
 */

/** 生成 UUID v4 */
export function generateUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/** 生成 Short ID (1-16 位十六进制) */
export function generateShortId(length = 8): string {
  return randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/** 生成安全随机密码 */
export function generatePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  return Array.from(bytes).map(b => chars[b % chars.length]).join('');
}

/** 生成 SS-2022 密钥 (base64) */
export function generateSS2022Key(method: string): string {
  let keyLen: number;
  switch (method) {
    case '2022-blake3-aes-128-gcm': keyLen = 16; break;
    case '2022-blake3-aes-256-gcm': keyLen = 32; break;
    case '2022-blake3-chacha20-poly1305': keyLen = 32; break;
    default: keyLen = 32;
  }
  return randomBytes(keyLen).toString('base64');
}

/**
 * 生成 X25519 密钥对 (Reality 用)
 *
 * 优先使用 xray x25519 命令,
 * 不可用时回退到 Node.js crypto
 */
export async function generateX25519(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  // 方法1: 尝试 xray 二进制
  const xrayResult = await runCommand(
    'xray x25519 2>/dev/null || /usr/local/x-ui/bin/xray-linux-* x25519 2>/dev/null',
    5000,
  );

  if (xrayResult.code === 0 && xrayResult.stdout) {
    const privMatch = xrayResult.stdout.match(/Private key:\s*(\S+)/);
    const pubMatch = xrayResult.stdout.match(/Public key:\s*(\S+)/);
    if (privMatch && pubMatch) {
      return { privateKey: privMatch[1], publicKey: pubMatch[1] };
    }
  }

  // 方法2: Node.js crypto (需要 Node 18+)
  try {
    const { generateKeyPairSync } = await import('crypto');
    const { privateKey, publicKey } = generateKeyPairSync('x25519');

    const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
    const pubDer = publicKey.export({ type: 'spki', format: 'der' });

    // x25519 raw key 是 DER 结构的最后 32 字节
    const privRaw = privDer.subarray(privDer.length - 32);
    const pubRaw = pubDer.subarray(pubDer.length - 32);

    return {
      privateKey: Buffer.from(privRaw).toString('base64url'),
      publicKey: Buffer.from(pubRaw).toString('base64url'),
    };
  } catch (err: any) {
    logger.error(`X25519 生成失败: ${err.message}`);
    throw new Error('X25519 密钥生成失败: 需要 xray 二进制或 Node.js 18+');
  }
}

/**
 * 生成完整的 Reality 配置
 */
export async function generateRealityConfig(opts?: {
  dest?: string;
  serverNames?: string[];
}): Promise<{
  privateKey: string;
  publicKey: string;
  shortIds: string[];
  dest: string;
  serverNames: string[];
}> {
  const keys = await generateX25519();
  const dest = opts?.dest || 'www.google.com:443';
  const serverNames = opts?.serverNames || [dest.split(':')[0]];

  return {
    ...keys,
    shortIds: [generateShortId(8), generateShortId(4)],
    dest,
    serverNames,
  };
}

/**
 * 生成 WireGuard 密钥对
 */
export async function generateWgKeys(): Promise<{
  privateKey: string;
  publicKey: string;
}> {
  // 方法1: wg 命令
  const privResult = await runCommand('wg genkey 2>/dev/null', 3000);
  if (privResult.code === 0 && privResult.stdout) {
    const privKey = privResult.stdout.trim();
    const pubResult = await runCommand(`echo "${privKey}" | wg pubkey 2>/dev/null`, 3000);
    if (pubResult.code === 0) {
      return { privateKey: privKey, publicKey: pubResult.stdout.trim() };
    }
  }

  // 方法2: 纯 Node.js (curve25519)
  const { generateKeyPairSync } = await import('crypto');
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
  };
}
