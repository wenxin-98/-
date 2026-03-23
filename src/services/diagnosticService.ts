// src/services/diagnosticService.ts
/**
 * 协议/隧道诊断服务
 * - 端口占用预检
 * - 创建后存活验证
 * - TCP/UDP 连通性测试
 * - 转发延迟测量
 * - 隧道链路逐跳检测
 */

import axios from 'axios';
import { runCommand, isPortInUse } from '../utils/shell.js';
import { gostApi } from './gostService.js';
import { xuiApi } from './xuiService.js';
import { logger } from '../utils/logger.js';
import { ENV } from '../config.js';
import net from 'net';

export interface DiagResult {
  ok: boolean;
  tests: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warn' | 'skip';
    msg: string;
    ms?: number;  // 耗时
  }>;
  summary: string;
}

class DiagnosticService {

  // ===================================
  // ===== T1: 端口占用预检 =====
  // ===================================

  async checkPort(port: number): Promise<{
    inUse: boolean;
    process?: string;
  }> {
    const inUse = await isPortInUse(port);
    let process = '';
    if (inUse) {
      const res = await runCommand(`ss -tlnp | grep ":${port} " | awk '{print $6}' | head -1`, 3000);
      process = res.stdout.trim();
    }
    return { inUse, process };
  }

  async checkPortBatch(ports: number[]): Promise<Array<{
    port: number; inUse: boolean; process?: string;
  }>> {
    return Promise.all(ports.map(async port => {
      const { inUse, process } = await this.checkPort(port);
      return { port, inUse, process };
    }));
  }

  // ===================================
  // ===== T2: GOST 服务存活验证 =====
  // ===================================

  async verifyGostService(serviceName: string): Promise<{
    exists: boolean;
    running: boolean;
    listenPort?: number;
    portOpen?: boolean;
  }> {
    try {
      const services = await gostApi.listServices();
      const svc = services.find(s => s.name === serviceName);
      if (!svc) return { exists: false, running: false };

      // 从 addr 提取端口
      const portMatch = svc.addr?.match(/:(\d+)$/);
      const listenPort = portMatch ? parseInt(portMatch[1]) : 0;

      // 检测端口是否在监听
      let portOpen = false;
      if (listenPort) {
        portOpen = await isPortInUse(listenPort);
      }

      return { exists: true, running: portOpen, listenPort, portOpen };
    } catch {
      return { exists: false, running: false };
    }
  }

  // ===================================
  // ===== T3: Xray 入站验证 =====
  // ===================================

  async verifyXrayInbound(inboundId: number): Promise<{
    exists: boolean;
    enabled: boolean;
    portOpen: boolean;
    xrayRunning: boolean;
  }> {
    try {
      const ib = await xuiApi.getInbound(inboundId);
      if (!ib) return { exists: false, enabled: false, portOpen: false, xrayRunning: false };

      const portOpen = await isPortInUse(ib.port);

      // 检测 Xray 进程
      const xrayCheck = await runCommand('pgrep -f "xray" >/dev/null 2>&1 && echo running || echo stopped', 3000);
      const xrayRunning = xrayCheck.stdout.trim() === 'running';

      return {
        exists: true,
        enabled: ib.enable,
        portOpen,
        xrayRunning,
      };
    } catch {
      return { exists: false, enabled: false, portOpen: false, xrayRunning: false };
    }
  }

  // ===================================
  // ===== T5: TCP 连通性测试 =====
  // ===================================

  async testTcpConnect(host: string, port: number, timeoutMs = 5000): Promise<{
    connected: boolean;
    latencyMs: number;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();

      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ connected: false, latencyMs: timeoutMs, error: 'timeout' });
      }, timeoutMs);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ connected: true, latencyMs });
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ connected: false, latencyMs, error: err.message });
      });
    });
  }

  // ===================================
  // ===== T4/T6: 单条转发完整诊断 =====
  // ===================================

  async diagnoseForward(rule: {
    id: number;
    name: string;
    type: string;
    source: string;  // 'gost' | 'xui'
    listenAddr: string;
    targetAddr: string;
    gostServiceName?: string | null;
    xuiInboundId?: number | null;
    status: string;
  }): Promise<DiagResult> {
    const tests: DiagResult['tests'] = [];
    const start = Date.now();

    // 解析端口
    const portMatch = rule.listenAddr?.match(/:(\d+)$/);
    const listenPort = portMatch ? parseInt(portMatch[1]) : 0;
    const [targetHost, targetPortStr] = (rule.targetAddr || '').split(':');
    const targetPort = parseInt(targetPortStr) || 0;

    // ---- 测试 1: 引擎进程存活 ----
    if (rule.source === 'gost') {
      const gostCheck = await runCommand('systemctl is-active gost 2>/dev/null || pgrep -f gost >/dev/null && echo active || echo inactive', 3000);
      const active = gostCheck.stdout.trim().includes('active');
      tests.push({
        name: 'GOST 进程',
        status: active ? 'pass' : 'fail',
        msg: active ? 'GOST 服务运行中' : 'GOST 服务未运行',
      });
    } else {
      const xrayCheck = await runCommand('pgrep -f xray >/dev/null 2>&1 && echo active || echo inactive', 3000);
      const active = xrayCheck.stdout.trim().includes('active');
      tests.push({
        name: 'Xray 进程',
        status: active ? 'pass' : 'fail',
        msg: active ? 'Xray 进程运行中' : 'Xray 未运行',
      });
    }

    // ---- 测试 2: 服务注册验证 ----
    if (rule.source === 'gost' && rule.gostServiceName) {
      const verify = await this.verifyGostService(rule.gostServiceName.split(',')[0]);
      tests.push({
        name: 'GOST 服务注册',
        status: verify.exists ? 'pass' : 'fail',
        msg: verify.exists ? `服务 ${rule.gostServiceName} 已注册` : '服务未在 GOST 中找到',
      });
    } else if (rule.source === 'xui' && rule.xuiInboundId) {
      const verify = await this.verifyXrayInbound(rule.xuiInboundId);
      tests.push({
        name: 'Xray 入站注册',
        status: verify.exists ? (verify.enabled ? 'pass' : 'warn') : 'fail',
        msg: verify.exists
          ? (verify.enabled ? `入站 #${rule.xuiInboundId} 已启用` : `入站已注册但被禁用`)
          : '入站不存在',
      });
    }

    // ---- 测试 3: 监听端口 ----
    if (listenPort) {
      const portOpen = await isPortInUse(listenPort);
      tests.push({
        name: '端口监听',
        status: portOpen ? 'pass' : 'fail',
        msg: portOpen ? `端口 :${listenPort} 正在监听` : `端口 :${listenPort} 未监听`,
      });
    }

    // ---- 测试 4: TCP 连通性 (本机 → 监听端口) ----
    if (listenPort && rule.status === 'active') {
      const tcpTest = await this.testTcpConnect('127.0.0.1', listenPort, 3000);
      tests.push({
        name: 'TCP 握手',
        status: tcpTest.connected ? 'pass' : 'fail',
        msg: tcpTest.connected
          ? `本机 TCP 连通 (${tcpTest.latencyMs}ms)`
          : `TCP 连接失败: ${tcpTest.error}`,
        ms: tcpTest.latencyMs,
      });
    }

    // ---- 测试 5: 目标地址可达 (转发类) ----
    if (targetHost && targetPort && rule.type.includes('forward')) {
      const targetTest = await this.testTcpConnect(targetHost, targetPort, 5000);
      tests.push({
        name: '目标可达',
        status: targetTest.connected ? 'pass' : (targetTest.error === 'timeout' ? 'warn' : 'fail'),
        msg: targetTest.connected
          ? `目标 ${targetHost}:${targetPort} 可达 (${targetTest.latencyMs}ms)`
          : `目标不可达: ${targetTest.error}`,
        ms: targetTest.latencyMs,
      });
    }

    // ---- 测试 6: 端到端延迟 (通过转发端口连到目标) ----
    if (listenPort && targetHost && targetPort && rule.status === 'active') {
      const e2eTest = await this.testTcpConnect('127.0.0.1', listenPort, 5000);
      if (e2eTest.connected) {
        tests.push({
          name: '端到端延迟',
          status: e2eTest.latencyMs < 200 ? 'pass' : (e2eTest.latencyMs < 1000 ? 'warn' : 'fail'),
          msg: `经转发连接耗时 ${e2eTest.latencyMs}ms`,
          ms: e2eTest.latencyMs,
        });
      }
    }

    const passCount = tests.filter(t => t.status === 'pass').length;
    const failCount = tests.filter(t => t.status === 'fail').length;
    const totalMs = Date.now() - start;

    return {
      ok: failCount === 0,
      tests,
      summary: `${passCount}/${tests.length} 通过, ${failCount} 失败 (${totalMs}ms)`,
    };
  }

  // ===================================
  // ===== T8: 隧道链路逐跳检测 =====
  // ===================================

  async diagnoseChain(chain: {
    name: string;
    hops: Array<{ name: string; addr: string }>;
    gostChainName?: string;
  }): Promise<DiagResult> {
    const tests: DiagResult['tests'] = [];

    // 验证 GOST chain 注册
    if (chain.gostChainName) {
      try {
        const chains = await gostApi.listChains();
        const found = chains.find(c => c.name === chain.gostChainName);
        tests.push({
          name: '链路注册',
          status: found ? 'pass' : 'fail',
          msg: found ? `链路 ${chain.gostChainName} 已注册` : '链路未在 GOST 中找到',
        });
      } catch {
        tests.push({ name: '链路注册', status: 'fail', msg: 'GOST API 不可达' });
      }
    }

    // 逐跳 TCP 连通检测
    for (let i = 0; i < chain.hops.length; i++) {
      const hop = chain.hops[i];
      const [host, portStr] = (hop.addr || '').split(':');
      const port = parseInt(portStr) || 0;

      if (!host || !port) {
        tests.push({
          name: `跳 ${i + 1}: ${hop.name}`,
          status: 'skip',
          msg: `地址无效: ${hop.addr}`,
        });
        continue;
      }

      const tcpTest = await this.testTcpConnect(host, port, 5000);
      tests.push({
        name: `跳 ${i + 1}: ${hop.name}`,
        status: tcpTest.connected ? 'pass' : 'fail',
        msg: tcpTest.connected
          ? `${host}:${port} 可达 (${tcpTest.latencyMs}ms)`
          : `${host}:${port} 不可达: ${tcpTest.error}`,
        ms: tcpTest.latencyMs,
      });

      // 如果某一跳不通，后续跳也必然不通
      if (!tcpTest.connected) {
        for (let j = i + 1; j < chain.hops.length; j++) {
          tests.push({
            name: `跳 ${j + 1}: ${chain.hops[j].name}`,
            status: 'skip',
            msg: '前序节点不可达，跳过',
          });
        }
        break;
      }
    }

    const passCount = tests.filter(t => t.status === 'pass').length;
    const failCount = tests.filter(t => t.status === 'fail').length;

    return {
      ok: failCount === 0,
      tests,
      summary: `链路 ${chain.name}: ${passCount}/${tests.length} 通过, ${failCount} 失败`,
    };
  }

  // ===================================
  // ===== 全局诊断 =====
  // ===================================

  async diagnoseAll(rules: any[], chains: any[]): Promise<{
    gostApi: boolean;
    xuiApi: boolean;
    rules: Array<{ id: number; name: string; ok: boolean; summary: string }>;
    chains: Array<{ id: number; name: string; ok: boolean; summary: string }>;
  }> {
    // 引擎可达
    let gostOk = false, xuiOk = false;
    try {
      const svc = await gostApi.listServices();
      gostOk = true;
    } catch {}
    try {
      const ib = await xuiApi.listInbounds();
      xuiOk = true;
    } catch {}

    // 每条规则诊断
    const ruleResults = await Promise.all(
      rules.filter(r => r.status === 'active').slice(0, 20).map(async (r) => {
        const diag = await this.diagnoseForward(r);
        return { id: r.id, name: r.name, ok: diag.ok, summary: diag.summary };
      })
    );

    // 每条链路诊断
    const chainResults = await Promise.all(
      chains.slice(0, 10).map(async (c) => {
        const hops = typeof c.hops === 'string' ? JSON.parse(c.hops) : c.hops;
        const diag = await this.diagnoseChain({ name: c.name, hops, gostChainName: c.gostChainName });
        return { id: c.id, name: c.name, ok: diag.ok, summary: diag.summary };
      })
    );

    return { gostApi: gostOk, xuiApi: xuiOk, rules: ruleResults, chains: chainResults };
  }
}

export const diagnosticService = new DiagnosticService();
