// src/utils/shell.ts
import { exec, execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** 执行 shell 命令 */
export async function runCommand(cmd: string, timeout = 30000): Promise<ShellResult> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout });
    return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
  } catch (err: any) {
    logger.error(`命令执行失败: ${cmd}`, { error: err.message });
    return {
      stdout: err.stdout?.trim() || '',
      stderr: err.stderr?.trim() || err.message,
      code: err.code || 1,
    };
  }
}

/** 检查命令是否存在 */
export async function commandExists(cmd: string): Promise<boolean> {
  const result = await runCommand(`which ${cmd} 2>/dev/null`);
  return result.code === 0 && result.stdout.length > 0;
}

/** 检查端口是否被占用 */
export async function isPortInUse(port: number): Promise<boolean> {
  const result = await runCommand(`ss -tlnp | grep ":${port} " || true`);
  return result.stdout.length > 0;
}

/** 获取系统信息 */
export async function getSystemInfo() {
  const [cpu, mem, disk, uptime] = await Promise.all([
    runCommand("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'"),
    runCommand("free -m | awk 'NR==2{printf \"%d/%d\", $3, $2}'"),
    runCommand("df -h / | awk 'NR==2{printf \"%s/%s (%s)\", $3, $2, $5}'"),
    runCommand("uptime -p"),
  ]);
  
  return {
    cpuUsage: parseFloat(cpu.stdout) || 0,
    memory: mem.stdout,
    disk: disk.stdout,
    uptime: uptime.stdout.replace('up ', ''),
  };
}

/** 安全 JSON 解析 — 失败返回 fallback */
export function safeJsonParse(str: string | null | undefined, fallback: any = null): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/** 安全的 parseInt — NaN 返回 0 */
export function safeParseInt(str: string | undefined, fallback = 0): number {
  const n = parseInt(str || '', 10);
  return isNaN(n) ? fallback : n;
}
