// src/services/api.ts
import axios, { type AxiosInstance, type AxiosError } from 'axios';

const BASE = import.meta.env.VITE_API_BASE || '/api/v1';

class ApiClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: BASE, timeout: 30000 });

    this.http.interceptors.request.use(cfg => {
      const token = localStorage.getItem('token');
      if (token) cfg.headers.Authorization = `Bearer ${token}`;
      return cfg;
    });

    this.http.interceptors.response.use(
      res => res.data,
      (err: AxiosError<{ msg?: string }>) => {
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          window.location.hash = '#/login';
        }
        const msg = err.response?.data?.msg || err.message;
        return Promise.reject(new Error(msg));
      },
    );
  }

  // --- Auth ---
  login(username: string, password: string) {
    return this.http.post('/auth/login', { username, password }) as Promise<any>;
  }
  getProfile() {
    return this.http.get('/auth/profile') as Promise<any>;
  }
  changePassword(oldPassword: string, newPassword: string) {
    return this.http.post('/auth/change-password', { oldPassword, newPassword }) as Promise<any>;
  }

  // --- Dashboard ---
  getOverview() {
    return this.http.get('/dashboard/overview') as Promise<any>;
  }
  getSystemInfo() {
    return this.http.get('/dashboard/system') as Promise<any>;
  }
  getLogs(page = 1, pageSize = 20) {
    return this.http.get('/dashboard/logs', { params: { page, pageSize } }) as Promise<any>;
  }
  getTrafficSummary(range = '24h') {
    return this.http.get('/traffic/summary', { params: { range } }) as Promise<any>;
  }
  getTrafficByRule() {
    return this.http.get('/traffic/by-rule') as Promise<any>;
  }

  // --- GOST ---
  getGostStatus() {
    return this.http.get('/gost/status') as Promise<any>;
  }
  getGostConfig() {
    return this.http.get('/gost/config') as Promise<any>;
  }
  listForwards() {
    return this.http.get('/gost/forwards') as Promise<any>;
  }
  createForward(data: any) {
    return this.http.post('/gost/forwards', data) as Promise<any>;
  }
  deleteForward(id: number) {
    return this.http.delete(`/gost/forwards/${id}`) as Promise<any>;
  }
  toggleForward(id: number) {
    return this.http.put(`/gost/forwards/${id}/toggle`) as Promise<any>;
  }
  listChains() {
    return this.http.get('/gost/chains') as Promise<any>;
  }
  createChain(data: any) {
    return this.http.post('/gost/chains', data) as Promise<any>;
  }
  deleteChain(id: number) {
    return this.http.delete(`/gost/chains/${id}`) as Promise<any>;
  }
  getRawServices() {
    return this.http.get('/gost/raw/services') as Promise<any>;
  }
  getRawChains() {
    return this.http.get('/gost/raw/chains') as Promise<any>;
  }

  // --- 3X-UI ---
  getXuiStatus() {
    return this.http.get('/xui/status') as Promise<any>;
  }
  listInbounds() {
    return this.http.get('/xui/inbounds') as Promise<any>;
  }
  createInbound(data: any) {
    return this.http.post('/xui/inbounds', data) as Promise<any>;
  }
  updateInbound(id: number, data: any) {
    return this.http.put(`/xui/inbounds/${id}`, data) as Promise<any>;
  }
  deleteInbound(id: number) {
    return this.http.delete(`/xui/inbounds/${id}`) as Promise<any>;
  }
  toggleInbound(id: number, enable: boolean) {
    return this.http.put(`/xui/inbounds/${id}/toggle`, { enable }) as Promise<any>;
  }
  resetInboundTraffic(id: number) {
    return this.http.post(`/xui/inbounds/${id}/reset-traffic`) as Promise<any>;
  }
  restartXray() {
    return this.http.post('/xui/restart-xray') as Promise<any>;
  }
  getXuiServerStatus() {
    return this.http.get('/xui/server-status') as Promise<any>;
  }

  // --- Xui 客户端 ---
  getClients(inboundId: number) {
    return this.http.get(`/xui/inbounds/${inboundId}/clients`) as Promise<any>;
  }
  addClient(inboundId: number, data: any) {
    return this.http.post(`/xui/inbounds/${inboundId}/clients`, data) as Promise<any>;
  }
  updateClient(inboundId: number, clientId: string, data: any) {
    return this.http.put(`/xui/inbounds/${inboundId}/clients/${clientId}`, data) as Promise<any>;
  }
  removeClient(inboundId: number, clientId: string) {
    return this.http.delete(`/xui/inbounds/${inboundId}/clients/${clientId}`) as Promise<any>;
  }
  resetClientTraffic(inboundId: number, email: string) {
    return this.http.post(`/xui/inbounds/${inboundId}/clients/${email}/reset-traffic`) as Promise<any>;
  }
  getQRCode(inboundId: number, addr?: string) {
    return this.http.get(`/sub/qr-data/${inboundId}${addr ? `?addr=${addr}` : ''}`) as Promise<any>;
  }

  // --- Nodes ---
  listNodes() {
    return this.http.get('/nodes') as Promise<any>;
  }
  createNode(data: any) {
    return this.http.post('/nodes', data) as Promise<any>;
  }
  deleteNode(id: number) {
    return this.http.delete(`/nodes/${id}`) as Promise<any>;
  }
  getNodeInstallScript(id: number) {
    return this.http.get(`/nodes/${id}/install-script`, { responseType: 'text' }) as Promise<any>;
  }
  deployNode(id: number, data: any) {
    return this.http.post(`/nodes/${id}/deploy`, data) as Promise<any>;
  }
  syncNodeConfig(id: number) {
    return this.http.post(`/nodes/${id}/sync`) as Promise<any>;
  }
  getNodeRemoteConfig(id: number) {
    return this.http.get(`/nodes/${id}/remote-config`) as Promise<any>;
  }
  clearNodeConfig(id: number) {
    return this.http.post(`/nodes/${id}/clear-config`) as Promise<any>;
  }

  // --- Settings ---
  getServiceStatus() {
    return this.http.get('/settings/service-status') as Promise<any>;
  }
  restartService(service: string) {
    return this.http.post('/settings/restart-service', { service }) as Promise<any>;
  }
  listCerts() {
    return this.http.get('/settings/certs') as Promise<any>;
  }
  generateSelfSignedCert(data: any) {
    return this.http.post('/settings/certs/self-signed', data) as Promise<any>;
  }
  requestAcmeCert(data: any) {
    return this.http.post('/settings/certs/acme', data) as Promise<any>;
  }
  backupDatabase() {
    return this.http.post('/settings/backup') as Promise<any>;
  }
  setIPWhitelist(ips: string[] | null) {
    return this.http.post('/settings/ip-whitelist', { ips }) as Promise<any>;
  }
  setIPBlacklist(action: string, ip: string) {
    return this.http.post('/settings/ip-blacklist', { action, ip }) as Promise<any>;
  }

  // --- BBR ---
  getBbrProbes() {
    return this.http.get('/bbr/probe') as Promise<any>;
  }
  getBbrProbeHistory(host: string) {
    return this.http.get(`/bbr/probe/${host}`) as Promise<any>;
  }
  triggerProbe(host: string) {
    return this.http.post(`/bbr/probe/${host}`) as Promise<any>;
  }
  getBbrSystem() {
    return this.http.get('/bbr/system') as Promise<any>;
  }
  enableBbr(profile: string) {
    return this.http.post('/bbr/system/enable', { profile }) as Promise<any>;
  }
  getBbrTuner() {
    return this.http.get('/bbr/tuner') as Promise<any>;
  }
  startTuner(intervalMs?: number) {
    return this.http.post('/bbr/tuner/start', { intervalMs }) as Promise<any>;
  }
  stopTuner() {
    return this.http.post('/bbr/tuner/stop') as Promise<any>;
  }
  getBbrRecommend(host: string) {
    return this.http.post(`/bbr/recommend/${host}`) as Promise<any>;
  }
  setKcpProfile(serviceName: string, profile: string) {
    return this.http.post(`/bbr/kcp/${serviceName}`, { profile }) as Promise<any>;
  }
  pushBbrToNode(nodeId: number, data: { sshPassword?: string; sshKeyPath?: string; profile: string }) {
    return this.http.post(`/bbr/remote/${nodeId}`, data) as Promise<any>;
  }
  pushBbrToAll(data: { sshPassword?: string; sshKeyPath?: string; profile: string }) {
    return this.http.post('/bbr/remote-all', data) as Promise<any>;
  }

  // --- Users ---
  listUsers() {
    return this.http.get('/users') as Promise<any>;
  }
  createUser(data: any) {
    return this.http.post('/users', data) as Promise<any>;
  }
  updateUser(id: number, data: any) {
    return this.http.put(`/users/${id}`, data) as Promise<any>;
  }
  deleteUser(id: number) {
    return this.http.delete(`/users/${id}`) as Promise<any>;
  }
  resetUserTraffic(id: number) {
    return this.http.post(`/users/${id}/reset-traffic`) as Promise<any>;
  }
  refreshUserToken(id: number) {
    return this.http.post(`/users/${id}/refresh-token`) as Promise<any>;
  }

  // --- Tools ---
  exportData(includeLogs = false) {
    return this.http.get(`/tools/export${includeLogs ? '?include=logs' : ''}`) as Promise<any>;
  }
  importData(data: any) {
    return this.http.post('/tools/import', data) as Promise<any>;
  }
  getTelegramConfig() {
    return this.http.get('/tools/telegram') as Promise<any>;
  }
  saveTelegramConfig(data: any) {
    return this.http.post('/tools/telegram', data) as Promise<any>;
  }
  testTelegram(data: { botToken: string; chatId: string }) {
    return this.http.post('/tools/telegram/test', data) as Promise<any>;
  }

  // --- Keygen ---
  genUUID() {
    return this.http.post('/tools/keygen/uuid') as Promise<any>;
  }
  genReality(data?: { dest?: string; serverNames?: string[] }) {
    return this.http.post('/tools/keygen/reality', data || {}) as Promise<any>;
  }
  genX25519() {
    return this.http.post('/tools/keygen/x25519') as Promise<any>;
  }
  genWireGuard() {
    return this.http.post('/tools/keygen/wireguard') as Promise<any>;
  }
  genSS2022(method?: string) {
    return this.http.post('/tools/keygen/ss2022', { method }) as Promise<any>;
  }
  genPassword(length?: number) {
    return this.http.post('/tools/keygen/password', { length }) as Promise<any>;
  }

  // --- Per-client subscription ---
  getClientLink(inboundId: number, email: string, addr?: string) {
    return this.http.get(`/sub/client/${inboundId}/${encodeURIComponent(email)}${addr ? `?addr=${addr}` : ''}`) as Promise<any>;
  }

  // --- IP Check ---
  checkIP() {
    return this.http.get('/sub/check-ip') as Promise<any>;
  }
  checkIPRemote(data: { host: string; sshPassword?: string; sshPort?: number }) {
    return this.http.post('/sub/check-ip-remote', data) as Promise<any>;
  }

  // --- Load Balance ---
  createLoadBalance(data: { name: string; listenPort: number; targets: any[]; strategy?: string }) {
    return this.http.post('/gost/load-balance', data) as Promise<any>;
  }
  updateLoadBalance(serviceName: string, targets: any[]) {
    return this.http.put(`/gost/load-balance/${serviceName}`, { targets }) as Promise<any>;
  }

  // --- Version ---
  getVersion() {
    return this.http.get('/tools/version') as Promise<any>;
  }
  checkUpdate() {
    return this.http.get('/tools/check-update') as Promise<any>;
  }

  // --- Diagnostic ---
  checkPort(port: number) {
    return this.http.post('/diag/check-port', { port }) as Promise<any>;
  }
  checkPortBatch(ports: number[]) {
    return this.http.post('/diag/check-port', { ports }) as Promise<any>;
  }
  tcpTest(host: string, port: number) {
    return this.http.post('/diag/tcp-test', { host, port }) as Promise<any>;
  }
  diagnoseForward(id: number) {
    return this.http.get(`/diag/forward/${id}`) as Promise<any>;
  }
  diagnoseChain(id: number) {
    return this.http.get(`/diag/chain/${id}`) as Promise<any>;
  }
  diagnoseAll() {
    return this.http.get('/diag/all') as Promise<any>;
  }
}

export const api = new ApiClient();
