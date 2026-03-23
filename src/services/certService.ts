// src/services/certService.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { runCommand } from '../utils/shell.js';
import { logger } from '../utils/logger.js';
import { ENV } from '../config.js';

// 证书存储在数据库同级目录: /app/data/certs/
const CERT_DIR = resolve(dirname(ENV.DB_PATH), 'certs');

export interface CertInfo {
  domain: string;
  certPath: string;
  keyPath: string;
  issuer: string;
  expiry: string;
  autoRenew: boolean;
}

class CertService {

  constructor() {
    if (!existsSync(CERT_DIR)) {
      mkdirSync(CERT_DIR, { recursive: true });
    }
  }

  /**
   * 获取证书目录路径
   */
  getCertDir(): string {
    return CERT_DIR;
  }

  /**
   * 列出所有证书
   */
  async listCerts(): Promise<CertInfo[]> {
    const certs: CertInfo[] = [];

    // 检查自签证书
    const selfCert = resolve(CERT_DIR, 'server.crt');
    const selfKey = resolve(CERT_DIR, 'server.key');
    if (existsSync(selfCert) && existsSync(selfKey)) {
      const info = await this.getCertExpiry(selfCert);
      certs.push({
        domain: 'self-signed',
        certPath: selfCert,
        keyPath: selfKey,
        issuer: 'Self-Signed',
        expiry: info.expiry,
        autoRenew: false,
      });
    }

    // 检查 ACME 证书
    const acmeDir = resolve(CERT_DIR, 'acme');
    if (existsSync(acmeDir)) {
      const result = await runCommand(`ls -d ${acmeDir}/*/ 2>/dev/null || true`);
      const dirs = result.stdout.split('\n').filter(Boolean);
      for (const dir of dirs) {
        const domain = dir.replace(acmeDir + '/', '').replace(/\/$/, '');
        const cert = resolve(dir, 'fullchain.pem');
        const key = resolve(dir, 'privkey.pem');
        if (existsSync(cert) && existsSync(key)) {
          const info = await this.getCertExpiry(cert);
          certs.push({
            domain,
            certPath: cert,
            keyPath: key,
            issuer: 'ACME (Let\'s Encrypt)',
            expiry: info.expiry,
            autoRenew: true,
          });
        }
      }
    }

    return certs;
  }

  /**
   * 生成自签证书
   */
  async generateSelfSigned(opts?: {
    domain?: string;
    days?: number;
    ip?: string;
  }): Promise<{ certPath: string; keyPath: string }> {
    const domain = opts?.domain || 'localhost';
    const days = opts?.days || 3650;
    const ip = opts?.ip;

    const certPath = resolve(CERT_DIR, 'server.crt');
    const keyPath = resolve(CERT_DIR, 'server.key');

    // 生成包含 SAN 的证书 (现代浏览器/客户端需要 SAN)
    const sanEntries = [`DNS:${domain}`, 'DNS:localhost'];
    if (ip) sanEntries.push(`IP:${ip}`);
    sanEntries.push('IP:127.0.0.1');

    const opensslConf = resolve(CERT_DIR, 'openssl.cnf');
    writeFileSync(opensslConf, `
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
C = US
ST = State
L = City
O = UnifiedPanel
CN = ${domain}

[v3_req]
subjectAltName = ${sanEntries.join(',')}
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
`);

    const result = await runCommand(
      `openssl req -x509 -newkey rsa:2048 -nodes ` +
      `-keyout "${keyPath}" -out "${certPath}" ` +
      `-days ${days} -config "${opensslConf}" -extensions v3_req`,
    );

    if (result.code !== 0) {
      throw new Error(`证书生成失败: ${result.stderr}`);
    }

    // 清理临时配置
    await runCommand(`rm -f "${opensslConf}"`);

    logger.info(`自签证书已生成: ${domain} (${days} 天)`);
    return { certPath, keyPath };
  }

  /**
   * ACME 申请证书 (Let's Encrypt)
   * 需要系统已安装 acme.sh 或 certbot
   */
  async requestACME(opts: {
    domain: string;
    email: string;
    dnsProvider?: string;   // cloudflare, aliyun, dnspod ...
    envVars?: Record<string, string>;   // CF_Key, CF_Email etc
    useStandalone?: boolean;  // 使用 standalone 模式 (需要 80 端口)
  }): Promise<{ certPath: string; keyPath: string }> {
    const acmeDir = resolve(CERT_DIR, 'acme', opts.domain);
    mkdirSync(acmeDir, { recursive: true });

    // 检查 acme.sh 是否安装
    const hasAcme = (await runCommand('which acme.sh 2>/dev/null || which ~/.acme.sh/acme.sh 2>/dev/null')).code === 0;
    const hasCertbot = (await runCommand('which certbot 2>/dev/null')).code === 0;

    if (hasAcme) {
      return this.requestViaAcmeSh(opts, acmeDir);
    } else if (hasCertbot) {
      return this.requestViaCertbot(opts, acmeDir);
    }

    // 自动安装 acme.sh (支持国内镜像)
    logger.info('安装 acme.sh...');
    // 优先尝试国内 gitee 镜像
    let installResult = await runCommand(
      `curl -sf --connect-timeout 5 https://gitee.com/neilpang/acme.sh/raw/master/acme.sh | sh -s -- --install-online --email ${opts.email}`,
      120000,
    );
    if (installResult.code !== 0) {
      // 回退到 GitHub
      installResult = await runCommand(
        `curl https://get.acme.sh | sh -s email=${opts.email}`,
        120000,
      );
    }
    if (installResult.code !== 0) {
      throw new Error(`acme.sh 安装失败: ${installResult.stderr}`);
    }

    return this.requestViaAcmeSh(opts, acmeDir);
  }

  private async requestViaAcmeSh(
    opts: { domain: string; email: string; dnsProvider?: string; envVars?: Record<string, string>; useStandalone?: boolean },
    acmeDir: string,
  ): Promise<{ certPath: string; keyPath: string }> {
    const acmeBin = existsSync(`${process.env.HOME}/.acme.sh/acme.sh`)
      ? `${process.env.HOME}/.acme.sh/acme.sh`
      : 'acme.sh';

    if (opts.useStandalone) {
      // Standalone 模式 (需要 80 端口空闲)
      const nginxWasRunning = (await runCommand('systemctl is-active nginx 2>/dev/null')).stdout.trim() === 'active';
      if (nginxWasRunning) {
        logger.info('临时停止 Nginx 以释放 80 端口...');
        await runCommand('systemctl stop nginx');
      }
      
      const issueCmd = `${acmeBin} --issue -d ${opts.domain} --standalone --server letsencrypt`;
      const issueResult = await runCommand(issueCmd, 300000);

      if (nginxWasRunning) {
        await runCommand('systemctl start nginx');
        logger.info('Nginx 已恢复');
      }

      if (issueResult.code !== 0 && !issueResult.stdout.includes('already been issued')) {
        throw new Error(`ACME 申请失败: ${issueResult.stderr}`);
      }
    } else if (opts.dnsProvider) {
      // DNS 验证模式
      const envStr = Object.entries(opts.envVars || {})
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      const issueCmd = `${envStr} ${acmeBin} --issue -d ${opts.domain} --dns dns_${opts.dnsProvider} --server letsencrypt`;
      
      const issueResult = await runCommand(issueCmd, 300000);
      if (issueResult.code !== 0 && !issueResult.stdout.includes('already been issued')) {
        throw new Error(`ACME 申请失败: ${issueResult.stderr}`);
      }
    } else {
      throw new Error('请指定 DNS 验证商或使用 standalone 模式');
    }

    // 安装证书到指定目录
    const certPath = resolve(acmeDir, 'fullchain.pem');
    const keyPath = resolve(acmeDir, 'privkey.pem');

    await runCommand(
      `${acmeBin} --install-cert -d ${opts.domain} ` +
      `--fullchain-file "${certPath}" --key-file "${keyPath}" ` +
      `--reloadcmd "systemctl reload nginx 2>/dev/null; systemctl restart gost 2>/dev/null"`,
    );

    logger.info(`ACME 证书已签发: ${opts.domain}`);
    return { certPath, keyPath };
  }

  private async requestViaCertbot(
    opts: { domain: string; email: string; useStandalone?: boolean },
    acmeDir: string,
  ): Promise<{ certPath: string; keyPath: string }> {
    const cmd = opts.useStandalone
      ? `certbot certonly --standalone -d ${opts.domain} --email ${opts.email} --agree-tos --non-interactive`
      : `certbot certonly --nginx -d ${opts.domain} --email ${opts.email} --agree-tos --non-interactive`;

    const result = await runCommand(cmd, 300000);
    if (result.code !== 0) {
      throw new Error(`Certbot 申请失败: ${result.stderr}`);
    }

    // certbot 证书默认路径
    const liveDir = `/etc/letsencrypt/live/${opts.domain}`;
    const certPath = resolve(liveDir, 'fullchain.pem');
    const keyPath = resolve(liveDir, 'privkey.pem');

    // 复制到面板目录
    await runCommand(`cp "${certPath}" "${acmeDir}/fullchain.pem"`);
    await runCommand(`cp "${keyPath}" "${acmeDir}/privkey.pem"`);

    return {
      certPath: resolve(acmeDir, 'fullchain.pem'),
      keyPath: resolve(acmeDir, 'privkey.pem'),
    };
  }

  /**
   * 获取证书过期时间
   */
  private async getCertExpiry(certPath: string): Promise<{ expiry: string; daysLeft: number }> {
    const result = await runCommand(
      `openssl x509 -in "${certPath}" -noout -enddate 2>/dev/null | cut -d= -f2`,
    );
    const expiryStr = result.stdout.trim();
    if (!expiryStr) return { expiry: 'unknown', daysLeft: -1 };

    const expiry = new Date(expiryStr);
    const daysLeft = Math.floor((expiry.getTime() - Date.now()) / (86400 * 1000));
    return { expiry: expiry.toISOString().slice(0, 10), daysLeft };
  }

  /**
   * 检查证书是否即将过期 (30 天内)
   */
  async checkExpiring(): Promise<CertInfo[]> {
    const certs = await this.listCerts();
    const expiring: CertInfo[] = [];

    for (const cert of certs) {
      const info = await this.getCertExpiry(cert.certPath);
      if (info.daysLeft >= 0 && info.daysLeft <= 30) {
        expiring.push(cert);
        logger.warn(`证书即将过期: ${cert.domain} (${info.daysLeft} 天后)`);
      }
    }

    return expiring;
  }
}

export const certService = new CertService();
