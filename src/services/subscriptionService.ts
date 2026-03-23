// src/services/subscriptionService.ts

/**
 * Xray 协议订阅链接生成
 *
 * 支持:
 *   - VMess (base64 JSON)
 *   - VLESS (标准 URI)
 *   - Trojan (标准 URI)
 *   - Shadowsocks (SIP002)
 *   - Clash YAML
 */

export interface ShareLinkOpts {
  protocol: string;              // 所有协议类型
  address: string;
  port: number;
  remark: string;
  settings: any;
  streamSettings: any;
}

export function generateShareLink(opts: ShareLinkOpts): string {
  switch (opts.protocol) {
    case 'vmess':        return generateVmessLink(opts);
    case 'vless':        return generateVlessLink(opts);
    case 'trojan':       return generateTrojanLink(opts);
    case 'shadowsocks':  return generateSSLink(opts);
    case 'hysteria2':    return generateHysteria2Link(opts);
    case 'tuic':         return generateTuicLink(opts);
    case 'wireguard':    return generateWireguardLink(opts);
    default: return '';
  }
}

export function generateSubscription(links: string[]): string {
  return Buffer.from(links.join('\n')).toString('base64');
}

// ===== VMess =====

function generateVmessLink(opts: ShareLinkOpts): string {
  const client = opts.settings?.clients?.[0];
  if (!client) return '';

  const stream = opts.streamSettings || {};
  const vmessObj: any = {
    v: '2',
    ps: opts.remark,
    add: opts.address,
    port: opts.port,
    id: client.id,
    aid: client.alterId || 0,
    scy: 'auto',
    net: stream.network || 'tcp',
    type: 'none',
    host: '',
    path: '',
    tls: stream.security === 'tls' ? 'tls' : '',
    sni: '',
    alpn: '',
  };

  // Stream settings
  if (stream.network === 'ws' && stream.wsSettings) {
    vmessObj.path = stream.wsSettings.path || '/';
    vmessObj.host = stream.wsSettings.headers?.Host || '';
  } else if (stream.network === 'grpc' && stream.grpcSettings) {
    vmessObj.path = stream.grpcSettings.serviceName || '';
    vmessObj.type = 'gun';
  } else if (stream.network === 'h2' && stream.httpSettings) {
    vmessObj.path = stream.httpSettings.path || '/';
    vmessObj.host = (stream.httpSettings.host || []).join(',');
  } else if (stream.network === 'httpupgrade') {
    vmessObj.net = 'httpupgrade';
    vmessObj.path = stream.httpupgradeSettings?.path || '/';
    vmessObj.host = stream.httpupgradeSettings?.host || '';
  } else if (stream.network === 'splithttp') {
    vmessObj.net = 'splithttp';
    vmessObj.path = stream.splithttpSettings?.path || '/';
    vmessObj.host = stream.splithttpSettings?.host || '';
  } else if (stream.network === 'tcp' && stream.tcpSettings?.header?.type === 'http') {
    vmessObj.type = 'http';
    vmessObj.path = (stream.tcpSettings.header.request?.path || ['/'])[0];
  }

  if (stream.security === 'tls' && stream.tlsSettings) {
    vmessObj.sni = stream.tlsSettings.serverName || '';
    vmessObj.alpn = (stream.tlsSettings.alpn || []).join(',');
    vmessObj.fp = stream.tlsSettings.fingerprint || 'chrome';
  }

  return 'vmess://' + Buffer.from(JSON.stringify(vmessObj)).toString('base64');
}

// ===== VLESS =====

function generateVlessLink(opts: ShareLinkOpts): string {
  const client = opts.settings?.clients?.[0];
  if (!client) return '';

  const stream = opts.streamSettings || {};
  const params = new URLSearchParams();

  params.set('type', stream.network || 'tcp');
  params.set('encryption', 'none');

  if (client.flow) params.set('flow', client.flow);

  // Security
  if (stream.security === 'tls') {
    params.set('security', 'tls');
    if (stream.tlsSettings?.serverName) params.set('sni', stream.tlsSettings.serverName);
    if (stream.tlsSettings?.fingerprint) params.set('fp', stream.tlsSettings.fingerprint);
    if (stream.tlsSettings?.alpn?.length) params.set('alpn', stream.tlsSettings.alpn.join(','));
  } else if (stream.security === 'reality') {
    params.set('security', 'reality');
    const rs = stream.realitySettings || {};
    if (rs.serverNames?.[0]) params.set('sni', rs.serverNames[0]);
    if (rs.settings?.publicKey) params.set('pbk', rs.settings.publicKey);
    if (rs.settings?.fingerprint) params.set('fp', rs.settings.fingerprint);
    if (rs.shortIds?.[0]) params.set('sid', rs.shortIds[0]);
  } else {
    params.set('security', 'none');
  }

  // Transport
  if (stream.network === 'ws' && stream.wsSettings) {
    if (stream.wsSettings.path) params.set('path', stream.wsSettings.path);
    if (stream.wsSettings.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
  } else if (stream.network === 'grpc' && stream.grpcSettings) {
    if (stream.grpcSettings.serviceName) params.set('serviceName', stream.grpcSettings.serviceName);
    params.set('mode', stream.grpcSettings.multiMode ? 'multi' : 'gun');
  } else if (stream.network === 'httpupgrade') {
    const hu = stream.httpupgradeSettings || {};
    if (hu.path) params.set('path', hu.path);
    if (hu.host) params.set('host', hu.host);
  } else if (stream.network === 'splithttp') {
    const sh = stream.splithttpSettings || {};
    if (sh.path) params.set('path', sh.path);
    if (sh.host) params.set('host', sh.host);
  } else if (stream.network === 'h2') {
    const h2 = stream.httpSettings || {};
    if (h2.path) params.set('path', h2.path);
    if (h2.host?.[0]) params.set('host', h2.host[0]);
  } else if (stream.network === 'tcp') {
    const header = stream.tcpSettings?.header;
    if (header?.type === 'http') {
      params.set('headerType', 'http');
    }
  }

  const fragment = encodeURIComponent(opts.remark);
  return `vless://${client.id}@${opts.address}:${opts.port}?${params.toString()}#${fragment}`;
}

// ===== Trojan =====

function generateTrojanLink(opts: ShareLinkOpts): string {
  const client = opts.settings?.clients?.[0];
  if (!client) return '';

  const stream = opts.streamSettings || {};
  const params = new URLSearchParams();

  params.set('type', stream.network || 'tcp');

  if (stream.security === 'tls') {
    params.set('security', 'tls');
    if (stream.tlsSettings?.serverName) params.set('sni', stream.tlsSettings.serverName);
    if (stream.tlsSettings?.fingerprint) params.set('fp', stream.tlsSettings.fingerprint);
    if (stream.tlsSettings?.alpn?.length) params.set('alpn', stream.tlsSettings.alpn.join(','));
  } else if (stream.security === 'reality') {
    params.set('security', 'reality');
    const rs = stream.realitySettings || {};
    if (rs.serverNames?.[0]) params.set('sni', rs.serverNames[0]);
    if (rs.settings?.publicKey) params.set('pbk', rs.settings.publicKey);
  } else {
    params.set('security', 'none');
  }

  if (stream.network === 'ws' && stream.wsSettings) {
    if (stream.wsSettings.path) params.set('path', stream.wsSettings.path);
    if (stream.wsSettings.headers?.Host) params.set('host', stream.wsSettings.headers.Host);
  } else if (stream.network === 'grpc' && stream.grpcSettings) {
    if (stream.grpcSettings.serviceName) params.set('serviceName', stream.grpcSettings.serviceName);
  } else if (stream.network === 'httpupgrade') {
    const hu = stream.httpupgradeSettings || {};
    if (hu.path) params.set('path', hu.path);
    if (hu.host) params.set('host', hu.host);
  } else if (stream.network === 'splithttp') {
    const sh = stream.splithttpSettings || {};
    if (sh.path) params.set('path', sh.path);
    if (sh.host) params.set('host', sh.host);
  }

  const password = client.password;
  const fragment = encodeURIComponent(opts.remark);
  return `trojan://${password}@${opts.address}:${opts.port}?${params.toString()}#${fragment}`;
}

// ===== Shadowsocks (SIP002) =====

function generateSSLink(opts: ShareLinkOpts): string {
  const method = opts.settings?.method || 'aes-256-gcm';
  const password = opts.settings?.password || '';

  // SIP002: base64url(method:password) — 无 padding
  const userInfo = Buffer.from(`${method}:${password}`)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const fragment = encodeURIComponent(opts.remark);
  return `ss://${userInfo}@${opts.address}:${opts.port}#${fragment}`;
}

// ===== Hysteria2 =====

function generateHysteria2Link(opts: ShareLinkOpts): string {
  const client = opts.settings?.clients?.[0];
  if (!client) return '';

  const params = new URLSearchParams();
  const stream = opts.streamSettings || {};

  if (stream.tlsSettings?.serverName) params.set('sni', stream.tlsSettings.serverName);
  if (opts.settings?.obfs?.type) {
    params.set('obfs', opts.settings.obfs.type);
    if (opts.settings.obfs.password) params.set('obfs-password', opts.settings.obfs.password);
  }

  params.set('insecure', '1');
  const fragment = encodeURIComponent(opts.remark);
  return `hysteria2://${client.password}@${opts.address}:${opts.port}?${params.toString()}#${fragment}`;
}

// ===== TUIC v5 =====

function generateTuicLink(opts: ShareLinkOpts): string {
  const client = opts.settings?.clients?.[0];
  if (!client) return '';

  const params = new URLSearchParams();
  const stream = opts.streamSettings || {};

  params.set('congestion_control', opts.settings?.congestion || 'bbr');
  params.set('udp_relay_mode', 'native');
  params.set('alpn', 'h3');

  if (stream.tlsSettings?.serverName) params.set('sni', stream.tlsSettings.serverName);

  const fragment = encodeURIComponent(opts.remark);
  return `tuic://${client.id}:${client.password}@${opts.address}:${opts.port}?${params.toString()}#${fragment}`;
}

// ===== WireGuard =====

function generateWireguardLink(opts: ShareLinkOpts): string {
  const fragment = encodeURIComponent(opts.remark);
  const params = new URLSearchParams();

  params.set('mtu', String(opts.settings?.mtu || 1420));
  // 客户端需要: 服务端公钥 + 客户端私钥
  if (opts.settings?._serverPublicKey) params.set('publickey', opts.settings._serverPublicKey);
  if (opts.settings?._clientPrivateKey) params.set('privatekey', opts.settings._clientPrivateKey);
  params.set('address', '10.0.0.2/32');  // 默认客户端 IP

  return `wireguard://${opts.address}:${opts.port}?${params.toString()}#${fragment}`;
}

// ===== Clash proxy node =====

export function generateClashProxy(opts: ShareLinkOpts): any {
  const stream = opts.streamSettings || {};
  const base: any = {
    name: opts.remark,
    server: opts.address,
    port: opts.port,
  };

  switch (opts.protocol) {
    case 'vmess': {
      const client = opts.settings?.clients?.[0];
      return {
        ...base, type: 'vmess', uuid: client?.id,
        alterId: client?.alterId || 0, cipher: 'auto',
        tls: stream.security === 'tls',
        ...(stream.network === 'ws' && {
          network: 'ws', 'ws-opts': {
            path: stream.wsSettings?.path || '/',
            headers: stream.wsSettings?.headers || {},
          },
        }),
        ...(stream.network === 'grpc' && {
          network: 'grpc', 'grpc-opts': { 'grpc-service-name': stream.grpcSettings?.serviceName },
        }),
        ...(stream.network === 'httpupgrade' && {
          network: 'ws', 'ws-opts': {
            path: stream.httpupgradeSettings?.path || '/',
            'v2ray-http-upgrade': true,
          },
        }),
        ...(stream.network === 'h2' && {
          network: 'h2', 'h2-opts': {
            path: stream.httpSettings?.path || '/',
            host: stream.httpSettings?.host || [],
          },
        }),
      };
    }
    case 'vless': {
      const client = opts.settings?.clients?.[0];
      const result: any = {
        ...base, type: 'vless', uuid: client?.id,
        flow: client?.flow || '',
        tls: stream.security === 'tls' || stream.security === 'reality',
        network: stream.network || 'tcp',
      };
      if (stream.security === 'reality') {
        result['reality-opts'] = {
          'public-key': stream.realitySettings?.settings?.publicKey,
          'short-id': stream.realitySettings?.shortIds?.[0],
        };
        result['client-fingerprint'] = stream.realitySettings?.settings?.fingerprint || 'chrome';
        result.servername = stream.realitySettings?.serverNames?.[0];
      }
      if (stream.network === 'ws') {
        result['ws-opts'] = { path: stream.wsSettings?.path || '/' };
      }
      if (stream.network === 'grpc') {
        result['grpc-opts'] = { 'grpc-service-name': stream.grpcSettings?.serviceName };
      }
      if (stream.network === 'httpupgrade') {
        result.network = 'ws';  // Clash 用 ws 处理 httpupgrade
        result['ws-opts'] = {
          path: stream.httpupgradeSettings?.path || '/',
          headers: stream.httpupgradeSettings?.host ? { Host: stream.httpupgradeSettings.host } : {},
          'v2ray-http-upgrade': true,
        };
      }
      if (stream.network === 'h2') {
        result.network = 'h2';
        result['h2-opts'] = {
          path: stream.httpSettings?.path || '/',
          host: stream.httpSettings?.host || [],
        };
      }
      return result;
    }
    case 'trojan': {
      const client = opts.settings?.clients?.[0];
      const result: any = {
        ...base, type: 'trojan', password: client?.password,
        sni: stream.tlsSettings?.serverName || '',
        network: stream.network || 'tcp',
      };
      if (stream.network === 'ws') {
        result['ws-opts'] = { path: stream.wsSettings?.path || '/' };
      }
      if (stream.network === 'grpc') {
        result['grpc-opts'] = { 'grpc-service-name': stream.grpcSettings?.serviceName };
      }
      if (stream.network === 'httpupgrade') {
        result.network = 'ws';
        result['ws-opts'] = {
          path: stream.httpupgradeSettings?.path || '/',
          'v2ray-http-upgrade': true,
        };
      }
      return result;
    }
    case 'shadowsocks': {
      return {
        ...base, type: 'ss',
        cipher: opts.settings?.method || 'aes-256-gcm',
        password: opts.settings?.password || '',
      };
    }
    case 'hysteria2': {
      const client = opts.settings?.clients?.[0];
      const result: any = {
        ...base, type: 'hysteria2', password: client?.password,
        sni: stream.tlsSettings?.serverName || '',
        'skip-cert-verify': true,
      };
      if (opts.settings?.obfs?.type) {
        result.obfs = opts.settings.obfs.type;
        result['obfs-password'] = opts.settings.obfs.password;
      }
      return result;
    }
    case 'tuic': {
      const client = opts.settings?.clients?.[0];
      return {
        ...base, type: 'tuic', uuid: client?.id, password: client?.password,
        'congestion-controller': opts.settings?.congestion || 'bbr',
        'udp-relay-mode': 'native',
        'reduce-rtt': true,
        sni: stream.tlsSettings?.serverName || '',
        'skip-cert-verify': true,
      };
    }
    case 'wireguard': {
      return {
        ...base, type: 'wireguard',
        'private-key': opts.settings?._clientPrivateKey || '',   // 客户端私钥
        'public-key': opts.settings?._serverPublicKey || '',     // 服务端公钥
        ip: '10.0.0.2',
        mtu: opts.settings?.mtu || 1420,
        'allowed-ips': ['0.0.0.0/0', '::/0'],
      };
    }
    default:
      return base;
  }
}
