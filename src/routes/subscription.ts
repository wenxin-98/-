// src/routes/subscription.ts
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { xuiApi } from '../services/xuiService.js';
import { generateShareLink, generateSubscription, generateClashProxy, type ShareLinkOpts } from '../services/subscriptionService.js';
import { ENV } from '../config.js';
import { runCommand } from '../utils/shell.js';
import QRCode from 'qrcode';

const router = Router();

/** GET /api/v1/sub/links — 获取所有入站的分享链接 */
router.get('/links', requireAuth, async (req: Request, res: Response) => {
  try {
    const inbounds = await xuiApi.listInbounds();
    const serverAddr = (req.query.addr as string) || await getPublicIP();

    const links: Array<{
      id: number;
      remark: string;
      protocol: string;
      port: number;
      link: string;
    }> = [];

    for (const ib of inbounds) {
      if (!ib.enable) continue;

      const settings = safeParse(ib.settings);
      const streamSettings = safeParse(ib.streamSettings);

      const opts: ShareLinkOpts = {
        protocol: ib.protocol as any,
        address: serverAddr,
        port: ib.port,
        remark: ib.remark,
        settings,
        streamSettings,
      };

      const link = generateShareLink(opts);
      if (link) {
        links.push({
          id: ib.id,
          remark: ib.remark,
          protocol: ib.protocol,
          port: ib.port,
          link,
        });
      }
    }

    res.json({ ok: true, data: links });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/sub/link/:id — 单个入站的分享链接 */
router.get('/link/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const ib = await xuiApi.getInbound(id);
    if (!ib) return res.status(404).json({ ok: false, msg: '入站不存在' });

    const serverAddr = (req.query.addr as string) || await getPublicIP();

    const link = generateShareLink({
      protocol: ib.protocol as any,
      address: serverAddr,
      port: ib.port,
      remark: ib.remark,
      settings: safeParse(ib.settings),
      streamSettings: safeParse(ib.streamSettings),
    });

    res.json({ ok: true, data: { link } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/sub/base64 — Base64 订阅 (客户端直接导入) */
router.get('/base64', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).send('missing token');

    const { verifyToken } = await import('../middleware/auth.js');
    if (!verifyToken(token)) return res.status(401).send('invalid token');

    const inbounds = await xuiApi.listInbounds();
    const serverAddr = (req.query.addr as string) || await getPublicIP();

    const links: string[] = [];
    for (const ib of inbounds) {
      if (!ib.enable) continue;
      const link = generateShareLink({
        protocol: ib.protocol as any,
        address: serverAddr,
        port: ib.port,
        remark: ib.remark,
        settings: safeParse(ib.settings),
        streamSettings: safeParse(ib.streamSettings),
      });
      if (link) links.push(link);
    }

    const sub = generateSubscription(links);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Profile-Update-Interval', '6');  // 6 小时更新
    res.send(sub);
  } catch (err: any) {
    res.status(500).send(`error: ${err.message}`);
  }
});

/** GET /api/v1/sub/clash — Clash 订阅 */
router.get('/clash', async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) return res.status(401).send('missing token');

    const { verifyToken } = await import('../middleware/auth.js');
    if (!verifyToken(token)) return res.status(401).send('invalid token');

    const inbounds = await xuiApi.listInbounds();
    const serverAddr = (req.query.addr as string) || await getPublicIP();

    const proxies: any[] = [];
    const proxyNames: string[] = [];

    for (const ib of inbounds) {
      if (!ib.enable) continue;
      const proxy = generateClashProxy({
        protocol: ib.protocol as any,
        address: serverAddr,
        port: ib.port,
        remark: ib.remark,
        settings: safeParse(ib.settings),
        streamSettings: safeParse(ib.streamSettings),
      });
      proxies.push(proxy);
      proxyNames.push(ib.remark);
    }

    // 简单的 Clash 配置
    const clashYaml = [
      'mixed-port: 7890',
      'allow-lan: false',
      'mode: rule',
      'log-level: info',
      '',
      'proxies:',
      ...proxies.map(p => '  - ' + JSON.stringify(p)),
      '',
      'proxy-groups:',
      `  - { name: "Auto", type: url-test, proxies: [${proxyNames.map(n => `"${n}"`).join(', ')}], url: "http://www.gstatic.com/generate_204", interval: 300 }`,
      `  - { name: "Proxy", type: select, proxies: ["Auto", ${proxyNames.map(n => `"${n}"`).join(', ')}] }`,
      '',
      'rules:',
      '  - GEOIP,CN,DIRECT',
      '  - MATCH,Proxy',
    ].join('\n');

    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="clash.yaml"');
    res.send(clashYaml);
  } catch (err: any) {
    res.status(500).send(`error: ${err.message}`);
  }
});

// ===== 工具 =====

let cachedIP: string | null = null;
let ipCacheTime = 0;

async function getPublicIP(): Promise<string> {
  if (cachedIP && Date.now() - ipCacheTime < 300000) return cachedIP;
  // 不指定 -4/-6，让系统自动选择 (IPv6-only 机器返回 IPv6)
  // ip.sb 同时支持 IPv4 和 IPv6
  const result = await runCommand(
    'curl -sf --connect-timeout 3 ip.sb 2>/dev/null || ' +
    'curl -sf --connect-timeout 3 ifconfig.me 2>/dev/null || ' +
    'curl -sf --connect-timeout 3 icanhazip.com 2>/dev/null || ' +
    'echo "127.0.0.1"'
  );
  const ip = result.stdout.trim() || '127.0.0.1';
  // IPv6 地址需要方括号包裹 (用于 URL)
  cachedIP = ip.includes(':') ? `[${ip}]` : ip;
  ipCacheTime = Date.now();
  return cachedIP;
}

function safeParse(str: string): any {
  try { return JSON.parse(str); } catch { return str; }
}

// ============================
// ===== 单客户端订阅 =====
// ============================

/** GET /api/v1/sub/client/:inboundId/:email — 单客户端的所有链接 */
router.get('/client/:inboundId/:email', requireAuth, async (req: Request, res: Response) => {
  try {
    const inboundId = parseInt(req.params.inboundId as string);
    const email = decodeURIComponent(req.params.email as string);
    const ib = await xuiApi.getInbound(inboundId);
    if (!ib) return res.status(404).json({ ok: false, msg: '入站不存在' });

    const settings = safeParse(ib.settings);
    const streamSettings = safeParse(ib.streamSettings);
    const clients: any[] = settings?.clients || [];
    const client = clients.find((c: any) => c.email === email);
    if (!client) return res.status(404).json({ ok: false, msg: '客户端不存在' });

    const serverAddr = (req.query.addr as string) || await getPublicIP();

    // 构建只含该客户端的 settings
    const clientSettings = { ...settings, clients: [client] };

    const link = generateShareLink({
      protocol: ib.protocol as any,
      address: serverAddr,
      port: ib.port,
      remark: `${ib.remark}-${client.email}`,
      settings: clientSettings,
      streamSettings,
    });

    res.json({ ok: true, data: { link, email: client.email, remark: ib.remark, protocol: ib.protocol } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/sub/client-sub/:email — 某用户所有入站的 Base64 订阅 (用 email 匹配) */
router.get('/client-sub/:email', async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email as string);
    const serverAddr = (req.query.addr as string) || await getPublicIP();
    const inbounds = await xuiApi.listInbounds();

    const links: string[] = [];
    for (const ib of inbounds) {
      if (!ib.enable) continue;
      const settings = safeParse(ib.settings);
      const streamSettings = safeParse(ib.streamSettings);
      const clients: any[] = settings?.clients || [];
      const client = clients.find((c: any) => c.email === email && c.enable !== false);
      if (!client) continue;

      const clientSettings = { ...settings, clients: [client] };
      const link = generateShareLink({
        protocol: ib.protocol as any,
        address: serverAddr,
        port: ib.port,
        remark: `${ib.remark}-${client.email}`,
        settings: clientSettings,
        streamSettings,
      });
      if (link) links.push(link);
    }

    const sub = generateSubscription(links);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(sub);
  } catch (err: any) {
    res.status(500).send('');
  }
});

// ============================
// ===== 落地 IP 检测 =====
// ============================

/** GET /api/v1/sub/check-ip — 检测当前服务器出口 IP + 地理位置 */
router.get('/check-ip', requireAuth, async (_req: Request, res: Response) => {
  try {
    // 并行检测 IPv4 + IPv6 + 地理信息
    // 不强制 -4/-6，先检测默认协议栈
    const [v4, v6, vDefault, geo] = await Promise.allSettled([
      runCommand('curl -4sf --connect-timeout 5 ip.sb 2>/dev/null'),
      runCommand('curl -6sf --connect-timeout 5 ip.sb 2>/dev/null'),
      runCommand('curl -sf --connect-timeout 5 ip.sb 2>/dev/null'),  // 自动选择
      runCommand('curl -sf --connect-timeout 5 "https://ipapi.co/json/" 2>/dev/null'),
    ]);

    const ipv4 = v4.status === 'fulfilled' ? v4.value.stdout.trim() : '';
    const ipv6 = v6.status === 'fulfilled' ? v6.value.stdout.trim() : '';
    const ipDefault = vDefault.status === 'fulfilled' ? vDefault.value.stdout.trim() : '';
    let geoInfo: any = null;
    if (geo.status === 'fulfilled' && geo.value.stdout) {
      try { geoInfo = JSON.parse(geo.value.stdout); } catch {}
    }

    res.json({
      ok: true,
      data: {
        ipv4: ipv4 || '',
        ipv6: ipv6 || '',
        default: ipDefault || ipv4 || ipv6 || '',
        ipv6Only: !ipv4 && !!ipv6,
        country: geoInfo?.country_name || '',
        countryCode: geoInfo?.country_code || '',
        city: geoInfo?.city || '',
        region: geoInfo?.region || '',
        org: geoInfo?.org || '',
        asn: geoInfo?.asn || '',
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** POST /api/v1/sub/check-ip-remote — 检测远程节点出口 IP (通过 SSH) */
router.post('/check-ip-remote', requireAuth, async (req: Request, res: Response) => {
  try {
    const { host, sshPassword, sshPort } = req.body;
    if (!host) return res.status(400).json({ ok: false, msg: '缺少 host' });

    const port = sshPort || 22;
    const sshOpts = `-o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${port}`;
    let sshCmd: string;
    if (sshPassword) {
      const escaped = sshPassword.replace(/'/g, "'\\''");
      sshCmd = `sshpass -p '${escaped}' ssh ${sshOpts} root@${host}`;
    } else {
      sshCmd = `ssh ${sshOpts} root@${host}`;
    }

    const result = await runCommand(`${sshCmd} "curl -sf --connect-timeout 5 ip.sb 2>/dev/null"`, 20000);
    const ip = result.stdout.trim();

    // 查地理信息
    let geo: any = null;
    if (ip) {
      const geoResult = await runCommand(`curl -sf --connect-timeout 5 "https://ipapi.co/${ip}/json/" 2>/dev/null`);
      if (geoResult.stdout) try { geo = JSON.parse(geoResult.stdout); } catch {}
    }

    res.json({
      ok: true,
      data: {
        host,
        ip,
        country: geo?.country_name || '',
        countryCode: geo?.country_code || '',
        city: geo?.city || '',
        org: geo?.org || '',
      },
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// ============================
// ===== QR Code =====
// ============================

/** GET /api/v1/sub/qr/:id — 单个入站的 QR Code (SVG) */
router.get('/qr/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const ib = await xuiApi.getInbound(id);
    if (!ib) return res.status(404).json({ ok: false, msg: '入站不存在' });

    const serverAddr = (req.query.addr as string) || await getPublicIP();
    const link = generateShareLink({
      protocol: ib.protocol as any,
      address: serverAddr,
      port: ib.port,
      remark: ib.remark,
      settings: safeParse(ib.settings),
      streamSettings: safeParse(ib.streamSettings),
    });

    if (!link) return res.status(400).json({ ok: false, msg: '该协议不支持分享链接' });

    const format = req.query.format || 'svg';

    if (format === 'svg') {
      const svg = await QRCode.toString(link, { type: 'svg', margin: 2, width: 300 });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    } else {
      const png = await QRCode.toBuffer(link, { type: 'png', margin: 2, width: 300 });
      res.setHeader('Content-Type', 'image/png');
      res.send(png);
    }
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

/** GET /api/v1/sub/qr-data/:id — QR Code 数据 (返回 base64 dataURL) */
router.get('/qr-data/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const ib = await xuiApi.getInbound(id);
    if (!ib) return res.status(404).json({ ok: false, msg: '入站不存在' });

    const serverAddr = (req.query.addr as string) || await getPublicIP();
    const link = generateShareLink({
      protocol: ib.protocol as any,
      address: serverAddr,
      port: ib.port,
      remark: ib.remark,
      settings: safeParse(ib.settings),
      streamSettings: safeParse(ib.streamSettings),
    });

    if (!link) return res.json({ ok: false, msg: '该协议不支持分享链接' });

    const dataUrl = await QRCode.toDataURL(link, { margin: 2, width: 300 });
    res.json({ ok: true, data: { link, qr: dataUrl, remark: ib.remark, protocol: ib.protocol } });
  } catch (err: any) {
    res.status(500).json({ ok: false, msg: err.message });
  }
});

export default router;
