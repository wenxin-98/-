#!/bin/bash
# ============================================================
#  统一转发管理面板 — 一键安装脚本 v1.9.0
#  集成: GOST v3 + 3X-UI + Panel
#  支持: 国内/海外自动切换镜像源
# ============================================================

# 不使用 set -e — 改用显式错误处理 (避免 apt 锁等导致静默退出)

# ============ 可配置参数 ============
PANEL_PORT=${PANEL_PORT:-9527}
GOST_API_PORT=${GOST_API_PORT:-18080}
XUI_PORT=${XUI_PORT:-2053}
NGINX_PORT=${NGINX_PORT:-80}
SKIP_NGINX=${SKIP_NGINX:-false}
PANEL_REPO="https://github.com/wenxin-98/-.git"
# NAT 端口范围 (可选)
PORT_RANGE_MIN=${PORT_RANGE_MIN:-0}
PORT_RANGE_MAX=${PORT_RANGE_MAX:-0}
INSTALL_DIR="/opt/unified-panel"
DATA_DIR="${INSTALL_DIR}/data"
GOST_VERSION="3.0.0-rc10"
NODE_VERSION="20"

# ============ 镜像源 (国内加速) ============
# 可通过环境变量覆盖:
#   USE_CN_MIRROR=true bash install.sh
# 或脚本自动检测
USE_CN_MIRROR=${USE_CN_MIRROR:-""}
GITHUB_PROXY=""
NPM_REGISTRY=""
NODE_MIRROR=""

# ============ 颜色 ============
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${GREEN}[✓]${NC} $1"; }
warn()    { echo -e "${YELLOW}[!]${NC} $1"; }
error()   { echo -e "${RED}[✗]${NC} $1"; exit 1; }
step()    { echo -e "\n${CYAN}${BOLD}>>> $1${NC}"; }
divider() { echo -e "${CYAN}$(printf '%.0s─' {1..50})${NC}"; }

# ============ 网络环境检测 ============
detect_network() {
    step "检测网络环境"

    if [ "$USE_CN_MIRROR" = "true" ]; then
        info "手动指定使用国内镜像"
        setup_cn_mirrors
        return
    fi

    # 测试 GitHub 连通性 (3 秒超时)
    if curl -sf --connect-timeout 3 -o /dev/null "https://github.com" 2>/dev/null; then
        info "GitHub 直连正常，使用国际源"
        GITHUB_PROXY=""
        NPM_REGISTRY="https://registry.npmjs.org"
        NODE_MIRROR="https://deb.nodesource.com"
    else
        warn "GitHub 不可达，切换到国内镜像源"
        setup_cn_mirrors
    fi
}

setup_cn_mirrors() {
    USE_CN_MIRROR="true"

    # GitHub 文件加速 (多个备选)
    # ghproxy.com / gh-proxy.com / mirror.ghproxy.com
    for proxy in "https://ghp.ci" "https://gh-proxy.com" "https://mirror.ghproxy.com"; do
        if curl -sf --connect-timeout 3 -o /dev/null "${proxy}" 2>/dev/null; then
            GITHUB_PROXY="${proxy}/"
            info "GitHub 代理: ${proxy}"
            break
        fi
    done

    if [ -z "$GITHUB_PROXY" ]; then
        # 回退: 使用 gitee 镜像或提示手动下载
        warn "未找到可用 GitHub 代理，部分组件可能需要手动安装"
    fi

    # npm 镜像
    NPM_REGISTRY="https://registry.npmmirror.com"
    info "NPM 源: ${NPM_REGISTRY}"

    # Node.js 镜像
    NODE_MIRROR="https://npmmirror.com/mirrors/node"
    info "Node.js 源: npmmirror.com"
}

# ============ 系统检测 ============
check_system() {
    step "系统环境检测"

    # root 检查
    [[ $(id -u) -ne 0 ]] && error "请以 root 权限运行此脚本"

    # 架构
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64|amd64)   ARCH="amd64" ;;
        aarch64|arm64)   ARCH="arm64" ;;
        armv7*)          ARCH="armv7" ;;
        *) error "不支持的架构: $ARCH" ;;
    esac

    # 系统类型
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
        OS_VERSION=$VERSION_ID
    elif [ -f /etc/redhat-release ]; then
        OS="centos"
    else
        error "无法识别操作系统"
    fi

    # 内存检查
    MEM_TOTAL=$(free -m | awk 'NR==2{print $2}')
    DISK_FREE=$(df -m / | awk 'NR==2{print $4}')
    CPU_CORES=$(nproc 2>/dev/null || echo 1)

    if [ "$MEM_TOTAL" -lt 256 ]; then
        error "内存不足! 最低 256MB，当前 ${MEM_TOTAL}MB。建议 512MB+。"
    elif [ "$MEM_TOTAL" -lt 512 ]; then
        warn "内存 ${MEM_TOTAL}MB 偏低"
        warn "  - 仅面板+GOST: 可以运行 (需要 swap)"
        warn "  - 全套 (含 3X-UI): 建议 512MB+"
        warn "正在创建 512MB swap..."
        if [ ! -f /swapfile ]; then
            dd if=/dev/zero of=/swapfile bs=1M count=512 2>/dev/null
            chmod 600 /swapfile
            mkswap /swapfile >/dev/null 2>&1
            swapon /swapfile >/dev/null 2>&1
            echo '/swapfile none swap sw 0 0' >> /etc/fstab
            info "512MB swap 已创建"
        fi
    fi

    if [ "$DISK_FREE" -lt 500 ]; then
        error "磁盘不足! 最低 500MB 可用，当前 ${DISK_FREE}MB"
    elif [ "$DISK_FREE" -lt 1024 ]; then
        warn "磁盘可用空间 ${DISK_FREE}MB 偏低，建议 1GB+"
    fi

    info "系统: ${OS} ${OS_VERSION}, 架构: ${ARCH}, 内存: ${MEM_TOTAL}MB, 磁盘可用: ${DISK_FREE}MB, CPU: ${CPU_CORES} 核"
}

# ============ 安装系统依赖 ============
install_deps() {
    step "安装系统依赖"

    case "$OS" in
        ubuntu|debian)
            export DEBIAN_FRONTEND=noninteractive
            export NEEDRESTART_MODE=a
            export NEEDRESTART_SUSPEND=1

            # ===== 暴力清理一切 =====
            info "停止后台自动更新..."
            systemctl kill unattended-upgrades 2>/dev/null
            systemctl mask unattended-upgrades apt-daily.service apt-daily-upgrade.service apt-daily.timer apt-daily-upgrade.timer 2>/dev/null
            killall -9 unattended-upgr apt-get apt dpkg aptd 2>/dev/null
            sleep 1
            # 删除所有锁 (不等待直接删)
            rm -f /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend \
                  /var/lib/apt/lists/lock /var/cache/apt/archives/lock 2>/dev/null
            # 非交互修复 dpkg (跳过所有提示)
            dpkg --configure -a --force-confdef --force-confold </dev/null 2>/dev/null || true
            info "清理完成"

            # ===== 切换快速 apt 源 =====
            info "切换 apt 源到阿里云..."
            local CODENAME=$(lsb_release -cs 2>/dev/null || cat /etc/os-release 2>/dev/null | grep VERSION_CODENAME | cut -d= -f2 || echo "noble")

            # 检测是 Debian 还是 Ubuntu (关键区别: 镜像路径不同)
            local IS_DEBIAN=false
            if grep -qi "debian" /etc/os-release 2>/dev/null; then
                IS_DEBIAN=true
            fi

            # 禁用 DEB822 格式源文件 (Ubuntu 24.04)
            if [ -f /etc/apt/sources.list.d/ubuntu.sources ]; then
                mv /etc/apt/sources.list.d/ubuntu.sources /etc/apt/sources.list.d/ubuntu.sources.bak
            fi

            # 备份原始源
            [ -f /etc/apt/sources.list ] && cp /etc/apt/sources.list /etc/apt/sources.list.bak

            if [ "$IS_DEBIAN" = "true" ]; then
                # Debian: mirrors.aliyun.com/debian/
                cat > /etc/apt/sources.list << APTEOF
deb http://mirrors.aliyun.com/debian/ ${CODENAME} main contrib non-free non-free-firmware
deb http://mirrors.aliyun.com/debian/ ${CODENAME}-updates main contrib non-free non-free-firmware
deb http://mirrors.aliyun.com/debian-security/ ${CODENAME}-security main contrib non-free non-free-firmware
deb http://mirrors.aliyun.com/debian/ ${CODENAME}-backports main contrib non-free non-free-firmware
APTEOF
                info "Debian ${CODENAME} → mirrors.aliyun.com/debian"
            else
                # Ubuntu: mirrors.aliyun.com/ubuntu/
                cat > /etc/apt/sources.list << APTEOF
deb http://mirrors.aliyun.com/ubuntu/ ${CODENAME} main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ ${CODENAME}-updates main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ ${CODENAME}-security main restricted universe multiverse
deb http://mirrors.aliyun.com/ubuntu/ ${CODENAME}-backports main restricted universe multiverse
APTEOF
                info "Ubuntu ${CODENAME} → mirrors.aliyun.com/ubuntu"
            fi

            # ===== apt-get update (前台运行, 用户能看到进度) =====
            info "更新软件源..."
            apt-get update -y -o Acquire::ForceIPv4=true </dev/null || warn "apt-get update 有警告"
            info "软件源已更新 ✓"

            # ===== apt-get install =====
            info "安装依赖包..."
            apt-get install -y \
                -o Acquire::ForceIPv4=true \
                -o Dpkg::Options::="--force-confdef" \
                -o Dpkg::Options::="--force-confold" \
                curl wget unzip jq git sqlite3 \
                openssl ca-certificates lsof net-tools \
                build-essential python3 \
                nginx sshpass \
                </dev/null || {
                warn "部分包失败，逐个安装..."
                for pkg in curl wget unzip jq git sqlite3 openssl ca-certificates lsof net-tools; do
                    apt-get install -y "$pkg" </dev/null 2>/dev/null
                done
                apt-get install -y nginx </dev/null 2>/dev/null || { warn "nginx 未安装"; SKIP_NGINX=true; }
                apt-get install -y sshpass </dev/null 2>/dev/null || warn "sshpass 未安装"
            }
            info "系统依赖安装完成 ✓"
            ;;
        centos|rhel|rocky|almalinux|fedora)
            info "安装依赖包..."
            yum install -y -q curl wget unzip jq git sqlite \
                nginx openssl ca-certificates lsof net-tools sshpass \
                gcc-c++ make python3
            info "YUM 依赖安装完成"
            ;;
        *)
            warn "未知系统 $OS，尝试 apt-get..."
            apt-get update -y -qq
            apt-get install -y -qq \
                curl wget unzip jq git sqlite3 nginx openssl sshpass
            ;;
    esac
}

# ============ 安装 Node.js ============
install_nodejs() {
    step "检测 / 安装 Node.js ${NODE_VERSION}"

    if command -v node &>/dev/null; then
        CURRENT_NODE=$(node -v | tr -d 'v' | cut -d. -f1)
        if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
            info "Node.js $(node -v) 已安装，跳过"
            setup_npm_registry
            return
        fi
        warn "Node.js 版本过低 ($(node -v))，升级中..."
    fi

    if [ "$USE_CN_MIRROR" = "true" ]; then
        # 国内: 使用 npmmirror 提供的 Node.js 安装脚本
        info "使用国内镜像安装 Node.js..."
        
        # 方式1: 直接下载二进制 (最可靠)
        NODE_URL="https://npmmirror.com/mirrors/node/v${NODE_VERSION}.19.0/node-v${NODE_VERSION}.19.0-linux-${ARCH}.tar.xz"
        # 获取实际最新版
        LATEST=$(curl -sf "https://npmmirror.com/mirrors/node/latest-v${NODE_VERSION}.x/" 2>/dev/null | grep -oP 'node-v[\d.]+' | head -1 | sed 's/node-//')
        if [ -n "$LATEST" ]; then
            NODE_URL="https://npmmirror.com/mirrors/node/${LATEST}/node-${LATEST}-linux-x64.tar.xz"
            [ "$ARCH" = "arm64" ] && NODE_URL="https://npmmirror.com/mirrors/node/${LATEST}/node-${LATEST}-linux-arm64.tar.xz"
        fi

        wget -qO /tmp/node.tar.xz "$NODE_URL" 2>/dev/null || \
        curl -sfL "$NODE_URL" -o /tmp/node.tar.xz

        if [ -f /tmp/node.tar.xz ]; then
            tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
            rm -f /tmp/node.tar.xz
        else
            # 回退: 尝试 nodesource
            warn "npmmirror 下载失败，尝试 nodesource..."
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1
            apt-get install -y -qq nodejs >/dev/null 2>&1 || yum install -y -q nodejs >/dev/null 2>&1
        fi
    else
        # 海外: 使用 nodesource 官方源
        case "$OS" in
            ubuntu|debian)
                curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1
                apt-get install -y -qq nodejs >/dev/null 2>&1
                ;;
            centos|rhel|rocky|almalinux|fedora)
                curl -fsSL "https://rpm.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1
                yum install -y -q nodejs >/dev/null 2>&1
                ;;
            *)
                curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - >/dev/null 2>&1
                apt-get install -y -qq nodejs >/dev/null 2>&1
                ;;
        esac
    fi

    if ! command -v node &>/dev/null; then
        error "Node.js 安装失败，请手动安装 Node.js ${NODE_VERSION}+ 后重试"
    fi

    # 安装 pnpm
    setup_npm_registry
    info "安装 pnpm..."
    npm install -g pnpm || true

    info "Node.js $(node -v) 安装完成"
}

setup_npm_registry() {
    if [ "$USE_CN_MIRROR" = "true" ]; then
        npm config set registry https://registry.npmmirror.com >/dev/null 2>&1
        info "npm 源已切换到 npmmirror.com"
    fi
}

# ============ 安装 PM2 ============
install_pm2() {
    if command -v pm2 &>/dev/null; then
        info "PM2 已安装，跳过"
        return
    fi

    step "安装 PM2"
    info "安装 PM2..."
    npm install -g pm2
    pm2 startup || true
    info "PM2 $(pm2 -v) 安装完成"
}

# ============ 安装 GOST v3 ============
install_gost() {
    step "安装 GOST v3"

    if [ -f /usr/local/bin/gost ]; then
        CURRENT_GOST=$(/usr/local/bin/gost -V 2>&1 | head -1 || echo "unknown")
        info "GOST 已安装: ${CURRENT_GOST}"
        read -p "  是否重新安装? [y/N]: " reinstall
        if [[ ! "$reinstall" =~ ^[Yy]$ ]]; then
            info "跳过 GOST 安装"
            setup_gost_config
            return
        fi
    fi

    GOST_ORIG_URL="https://github.com/go-gost/gost/releases/download/v${GOST_VERSION}/gost_${GOST_VERSION}_linux_${ARCH}.tar.gz"
    GOST_URL="${GITHUB_PROXY}${GOST_ORIG_URL}"
    info "下载 GOST ${GOST_VERSION} (${ARCH})..."

    if ! wget -qO /tmp/gost.tar.gz "$GOST_URL" 2>/dev/null && \
       ! curl -sfL "$GOST_URL" -o /tmp/gost.tar.gz 2>/dev/null; then
        # 二次回退: 直接连 GitHub
        if [ -n "$GITHUB_PROXY" ]; then
            warn "镜像下载失败，尝试直连 GitHub..."
            wget -qO /tmp/gost.tar.gz "$GOST_ORIG_URL" 2>/dev/null || \
            curl -sfL "$GOST_ORIG_URL" -o /tmp/gost.tar.gz 2>/dev/null || \
            error "GOST 下载失败。请手动下载: $GOST_ORIG_URL 放到 /tmp/gost.tar.gz 后重新运行"
        else
            error "GOST 下载失败"
        fi
    fi
    tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/ gost 2>/dev/null || \
        tar -xzf /tmp/gost.tar.gz -C /usr/local/bin/ 2>/dev/null
    chmod +x /usr/local/bin/gost
    rm -f /tmp/gost.tar.gz

    info "GOST $(/usr/local/bin/gost -V 2>&1 | head -1) 安装完成"
    setup_gost_config
}

setup_gost_config() {
    mkdir -p "${DATA_DIR}/gost"
    mkdir -p "${DATA_DIR}/certs"

    # 生成自签证书 (隧道用)
    if [ ! -f "${DATA_DIR}/certs/server.crt" ]; then
        info "生成自签 TLS 证书..."
        openssl req -x509 -newkey rsa:2048 -nodes \
            -keyout "${DATA_DIR}/certs/server.key" \
            -out "${DATA_DIR}/certs/server.crt" \
            -days 3650 \
            -subj "/C=US/ST=State/L=City/O=Panel/CN=$(curl -4sf --connect-timeout 3 ip.sb 2>/dev/null || curl -4sf --connect-timeout 3 ifconfig.me 2>/dev/null || echo localhost)" \
            >/dev/null 2>&1
        info "TLS 证书已生成"
    fi

    # GOST 配置 (启用 Web API — 仅本机访问)
    cat > "${DATA_DIR}/gost/config.yaml" <<EOF
api:
  addr: "127.0.0.1:${GOST_API_PORT}"
  accesslog: true

services: []
chains: []
EOF

    # systemd 服务
    cat > /etc/systemd/system/gost.service <<EOF
[Unit]
Description=GOST v3 Tunnel
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/gost -C ${DATA_DIR}/gost/config.yaml
Restart=always
RestartSec=5
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable gost >/dev/null 2>&1
    systemctl restart gost

    # 验证
    sleep 2
    if systemctl is-active gost >/dev/null 2>&1; then
        info "GOST 服务已启动, API 端口: ${GOST_API_PORT}"
    else
        warn "GOST 服务启动失败，请检查: journalctl -u gost -n 20"
    fi
}

# ============ 安装 3X-UI ============
install_3xui() {
    step "安装 3X-UI"

    if command -v x-ui &>/dev/null || [ -f /usr/local/x-ui/x-ui ]; then
        info "3X-UI 已安装"
        read -p "  是否重新安装? [y/N]: " reinstall
        if [[ ! "$reinstall" =~ ^[Yy]$ ]]; then
            info "跳过 3X-UI 安装"

            # 确保运行中
            systemctl is-active x-ui >/dev/null 2>&1 || systemctl start x-ui
            return
        fi
    fi

    info "执行 3X-UI 官方安装脚本..."
    
    XUI_SCRIPT_URL="https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh"
    if [ -n "$GITHUB_PROXY" ]; then
        XUI_SCRIPT_URL="${GITHUB_PROXY}${XUI_SCRIPT_URL}"
    fi

    # 下载安装脚本到本地执行 (比 pipe 更可靠)
    if curl -sfL "$XUI_SCRIPT_URL" -o /tmp/3xui_install.sh 2>/dev/null || \
       wget -qO /tmp/3xui_install.sh "$XUI_SCRIPT_URL" 2>/dev/null; then
        chmod +x /tmp/3xui_install.sh
        echo "y" | bash /tmp/3xui_install.sh 2>&1 | \
            while IFS= read -r line; do
                case "$line" in
                    *installed*|*started*|*success*|*完成*|*端口*|*port*)
                        echo "  $line"
                        ;;
                esac
            done
        rm -f /tmp/3xui_install.sh
    else
        # 最后回退: 直连 (可能很慢)
        warn "镜像下载 3X-UI 脚本失败，尝试直连..."
        echo "y" | bash <(curl -Ls https://raw.githubusercontent.com/mhsanaei/3x-ui/master/install.sh)
    fi

    sleep 3

    if systemctl is-active x-ui >/dev/null 2>&1; then
        info "3X-UI 安装完成, 默认端口: ${XUI_PORT}"
    else
        warn "3X-UI 可能未正常启动，请手动检查: x-ui status"
    fi
}

# ============ 部署面板 ============
deploy_panel() {
    step "部署统一面板"

    mkdir -p "${INSTALL_DIR}"
    mkdir -p "${DATA_DIR}"
    mkdir -p "${INSTALL_DIR}/logs"

    # 判断是否已有源码
    if [ -f "${INSTALL_DIR}/package.json" ]; then
        info "面板源码已存在，执行更新..."
        cd "${INSTALL_DIR}"
        git pull 2>/dev/null || true
    else
        info "从 GitHub 拉取面板源码..."
        # 先 clone 到临时目录，避免删除已有的 data/ 目录
        rm -rf /tmp/unified-panel-src 2>/dev/null
        git clone "$PANEL_REPO" /tmp/unified-panel-src || {
            warn "git clone 失败，尝试用 wget 下载..."
            mkdir -p /tmp/unified-panel-src
            wget -qO /tmp/panel.tar.gz "https://github.com/wenxin-98/-/archive/refs/heads/main.tar.gz" || error "面板下载失败"
            tar -xzf /tmp/panel.tar.gz -C /tmp/
            cp -r /tmp/---main/* /tmp/unified-panel-src/
            rm -rf /tmp/panel.tar.gz /tmp/---main
        }
        # 保留 data/ 和 .env，复制源码文件
        mkdir -p "${INSTALL_DIR}"
        rsync -a --exclude='data' --exclude='.env' --exclude='node_modules' \
            /tmp/unified-panel-src/ "${INSTALL_DIR}/" 2>/dev/null || \
            cp -r /tmp/unified-panel-src/* "${INSTALL_DIR}/"
        rm -rf /tmp/unified-panel-src
        cd "${INSTALL_DIR}"
    fi

    if [ ! -f "${INSTALL_DIR}/package.json" ]; then
        error "面板源码不完整 (缺少 package.json)"
    fi

    # 确保 GOST 配置目录存在 (git clone 可能覆盖)
    if [ ! -f "${DATA_DIR}/gost/config.yaml" ]; then
        mkdir -p "${DATA_DIR}/gost"
        cat > "${DATA_DIR}/gost/config.yaml" << GOSTEOF
api:
  addr: "127.0.0.1:${GOST_API_PORT}"
  accesslog: true

services: []
chains: []
GOSTEOF
        systemctl restart gost 2>/dev/null || true
        info "GOST 配置已重建"
    fi

    # 生成 .env
    JWT_SECRET=$(openssl rand -hex 32)
    # 双栈 IP 检测: 优先 IPv4
    PUBLIC_IPV4=$(curl -4sf --connect-timeout 3 ip.sb 2>/dev/null || curl -4sf --connect-timeout 3 ifconfig.me 2>/dev/null || curl -4sf --connect-timeout 3 icanhazip.com 2>/dev/null || echo "")
    PUBLIC_IPV6=$(curl -6sf --connect-timeout 3 ip.sb 2>/dev/null || curl -6sf --connect-timeout 3 ifconfig.me 2>/dev/null || echo "")
    # 优先用 IPv4 显示
    if [ -n "$PUBLIC_IPV4" ]; then
        PUBLIC_IP="$PUBLIC_IPV4"
    elif [ -n "$PUBLIC_IPV6" ]; then
        PUBLIC_IP="[$PUBLIC_IPV6]"
    else
        PUBLIC_IP="127.0.0.1"
    fi

    cat > "${INSTALL_DIR}/.env" <<EOF
# 面板配置 — 由安装脚本自动生成 $(date '+%Y-%m-%d %H:%M:%S')
PORT=${PANEL_PORT}
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
DB_PATH=${DATA_DIR}/panel.db
GOST_API=http://127.0.0.1:${GOST_API_PORT}
GOST_BIN=/usr/local/bin/gost
GOST_CONFIG=${DATA_DIR}/gost/config.yaml
XUI_API=http://127.0.0.1:${XUI_PORT}
XUI_USER=admin
XUI_PASS=admin
ADMIN_USER=admin
ADMIN_PASS=admin123
PORT_RANGE_MIN=${PORT_RANGE_MIN}
PORT_RANGE_MAX=${PORT_RANGE_MAX}
EOF

    # 安装依赖 (需要 devDependencies 来编译)
    # 关键: 临时设 NODE_ENV=development, 否则 pnpm 会跳过 devDependencies
    export NODE_ENV=development
    info "安装 Node.js 依赖..."
    if command -v pnpm &>/dev/null; then
        pnpm install || error "pnpm install 失败"
        cd web && pnpm install && cd ..
    else
        npm install || error "npm install 失败"
        cd web && npm install || error "前端 npm install 失败"
        cd ..
    fi

    # 构建后端
    info "编译后端 TypeScript..."
    npx tsup src/index.ts --format esm --target node20 --clean --sourcemap || error "后端编译失败"

    # 构建前端
    info "构建前端..."
    cd web && npx vite build || error "前端编译失败"
    cd ..

    # 构建完成后恢复 production
    export NODE_ENV=production

    # PM2 启动
    pm2 delete unified-panel 2>/dev/null || true
    pm2 start dist/index.js \
        --name "unified-panel" \
        --cwd "${INSTALL_DIR}" \
        --node-args="--experimental-specifier-resolution=node" \
        --max-memory-restart 256M \
        --log "${INSTALL_DIR}/logs/pm2.log" \
        --time
    pm2 save >/dev/null 2>&1

    sleep 3

    if pm2 list | grep -q "unified-panel.*online"; then
        info "面板已启动 (PM2), 端口: ${PANEL_PORT}"
    else
        warn "面板启动异常，查看日志: pm2 logs unified-panel --lines 30"
    fi
}

# ============ 配置 Nginx 反向代理 ============
setup_nginx() {
    # nginx 未安装则跳过
    if [ "$SKIP_NGINX" = "true" ] || ! command -v nginx &>/dev/null; then
        info "跳过 Nginx 配置 (面板直接监听 :${PANEL_PORT})"
        return
    fi

    step "配置 Nginx 反向代理"

    PUBLIC_IP=$(curl -4sf --connect-timeout 3 ip.sb 2>/dev/null || curl -4sf --connect-timeout 3 ifconfig.me 2>/dev/null || curl -6sf --connect-timeout 3 ip.sb 2>/dev/null || echo "0.0.0.0")

    # NAT 模式检测: 如果 80 端口不可用，使用面板端口直接访问
    if [ "$PORT_RANGE_MIN" -gt 0 ] && [ "$NGINX_PORT" -eq 80 ]; then
        if [ 80 -lt "$PORT_RANGE_MIN" ] || [ 80 -gt "$PORT_RANGE_MAX" ]; then
            warn "NAT 模式: 端口 80 不在允许范围 ${PORT_RANGE_MIN}-${PORT_RANGE_MAX}"
            NGINX_PORT=$PANEL_PORT
            warn "Nginx 将直接监听面板端口 ${NGINX_PORT}"
        fi
    fi

    # 备份已有默认配置
    [ -f /etc/nginx/sites-enabled/default ] && \
        mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak 2>/dev/null || true

    # 如果 Nginx 端口等于面板端口，则跳过 Nginx 反向代理（直连模式）
    if [ "$NGINX_PORT" -eq "$PANEL_PORT" ]; then
        info "NAT 模式: 跳过 Nginx，面板直接监听 :${PANEL_PORT}"
        rm -f /etc/nginx/conf.d/unified-panel.conf 2>/dev/null
        systemctl stop nginx 2>/dev/null || true
        return
    fi

    cat > /etc/nginx/conf.d/unified-panel.conf <<EOF
# ============================================
# 统一转发管理面板 — Nginx 反向代理
# ============================================

# 面板主站
server {
    listen ${NGINX_PORT};
    server_name _;

    client_max_body_size 50m;

    # --- 面板 API + 前端 ---
    location / {
        proxy_pass http://127.0.0.1:${PANEL_PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }

    # --- 3X-UI 面板 (iframe 嵌入) ---
    location /xui/ {
        proxy_pass http://127.0.0.1:${XUI_PORT}/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # --- GOST API (仅内网，生产环境建议限制 IP) ---
    location /gost-api/ {
        proxy_pass http://127.0.0.1:${GOST_API_PORT}/;
        proxy_set_header Host \$host;
        # allow 127.0.0.1;
        # deny all;
    }
}
EOF

    # 检查配置
    if nginx -t 2>/dev/null; then
        systemctl enable nginx >/dev/null 2>&1
        systemctl reload nginx
        info "Nginx 配置完成"
    else
        warn "Nginx 配置校验失败，请手动检查: nginx -t"
    fi
}

# ============ BBR 内核优化 ============
setup_bbr() {
    step "配置 BBR 拥塞控制"

    # 检查内核是否支持 BBR
    modprobe tcp_bbr 2>/dev/null
    AVAIL=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null)
    if ! echo "$AVAIL" | grep -q "bbr"; then
        warn "内核不支持 BBR (需要 Linux 4.9+)，跳过"
        return
    fi

    CURRENT_CC=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)
    if [ "$CURRENT_CC" = "bbr" ]; then
        info "BBR 已启用，跳过"
        return
    fi

    info "启用 BBR (balanced 策略)..."

    # 备份
    cp /etc/sysctl.conf /etc/sysctl.conf.bak.$(date +%s) 2>/dev/null

    # 移除旧配置
    sed -i '/# unified-panel-bbr/,/# end-unified-panel-bbr/d' /etc/sysctl.conf

    cat >> /etc/sysctl.conf << 'BBREOF'
# unified-panel-bbr
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
net.core.rmem_max=33554432
net.core.wmem_max=33554432
net.ipv4.tcp_rmem=4096 87380 33554432
net.ipv4.tcp_wmem=4096 65536 33554432
net.ipv4.tcp_mtu_probing=1
net.ipv4.tcp_fastopen=3
net.ipv4.tcp_slow_start_after_idle=0
net.ipv4.tcp_notsent_lowat=16384
# end-unified-panel-bbr
BBREOF

    sysctl -p >/dev/null 2>&1

    # 验证
    NEW_CC=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null)
    NEW_QD=$(sysctl -n net.core.default_qdisc 2>/dev/null)
    if [ "$NEW_CC" = "bbr" ]; then
        info "BBR 已启用 (cc=${NEW_CC}, qdisc=${NEW_QD})"
    else
        warn "BBR 启用失败 (当前: ${NEW_CC})，可在面板中手动配置"
    fi
}

# ============ 防火墙 ============
setup_firewall() {
    step "配置防火墙"

    # 尝试 ufw
    if command -v ufw &>/dev/null; then
        ufw allow 80/tcp >/dev/null 2>&1
        ufw allow 443/tcp >/dev/null 2>&1
        ufw allow ${PANEL_PORT}/tcp >/dev/null 2>&1
        info "UFW 规则已添加"
    # 尝试 firewalld
    elif command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port=80/tcp >/dev/null 2>&1
        firewall-cmd --permanent --add-port=443/tcp >/dev/null 2>&1
        firewall-cmd --permanent --add-port=${PANEL_PORT}/tcp >/dev/null 2>&1
        firewall-cmd --reload >/dev/null 2>&1
        info "firewalld 规则已添加"
    else
        info "未检测到防火墙服务，跳过"
    fi
}

# ============ 生成管理命令 ============
install_cli() {
    step "安装管理命令"

    cat > /usr/local/bin/up <<'CLIEOF'
#!/bin/bash
# up — 统一面板管理命令

INSTALL_DIR="/opt/unified-panel"

case "$1" in
    start)
        echo "启动所有服务..."
        systemctl start gost
        systemctl start x-ui 2>/dev/null || true
        pm2 start unified-panel 2>/dev/null || \
            pm2 start ${INSTALL_DIR}/dist/index.js --name unified-panel --cwd ${INSTALL_DIR}
        echo "✓ 所有服务已启动"
        ;;
    stop)
        echo "停止所有服务..."
        pm2 stop unified-panel 2>/dev/null
        systemctl stop gost 2>/dev/null
        echo "✓ 面板和 GOST 已停止 (3X-UI 保持运行)"
        ;;
    restart)
        echo "重启所有服务..."
        systemctl restart gost
        systemctl restart x-ui 2>/dev/null || true
        pm2 restart unified-panel
        echo "✓ 所有服务已重启"
        ;;
    status)
        echo "========== 服务状态 =========="
        echo -n "面板:  "; pm2 list 2>/dev/null | grep unified-panel | awk '{print $10}' || echo "未安装"
        echo -n "GOST:  "; systemctl is-active gost 2>/dev/null || echo "未安装"
        echo -n "3X-UI: "; systemctl is-active x-ui 2>/dev/null || echo "未安装"
        echo -n "Nginx: "; systemctl is-active nginx 2>/dev/null || echo "未安装"
        echo ""
        # 从 .env 读取端口
        local _P=\$(grep '^PORT=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || echo 9527)
        local _PR_MIN=\$(grep '^PORT_RANGE_MIN=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || echo 0)
        local _PR_MAX=\$(grep '^PORT_RANGE_MAX=' "${INSTALL_DIR}/.env" 2>/dev/null | cut -d= -f2 || echo 0)
        echo "========== 端口监听 =========="
        ss -tlnp | grep -E ":\${_P} |:${GOST_API_PORT} |:${XUI_PORT} " 2>/dev/null || echo "无"
        if [ "\${_PR_MIN}" -gt 0 ] 2>/dev/null; then
            echo ""
            echo "========== NAT 端口范围 =========="
            echo "允许范围: \${_PR_MIN}-\${_PR_MAX}"
        fi
        ;;
    logs)
        pm2 logs unified-panel --lines ${2:-50}
        ;;
    logs-gost)
        journalctl -u gost -n ${2:-50} --no-pager
        ;;
    bbr)
        echo "========== BBR 状态 =========="
        echo -n "拥塞控制: "; sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "未知"
        echo -n "队列调度: "; sysctl -n net.core.default_qdisc 2>/dev/null || echo "未知"
        echo -n "可用算法: "; sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo "未知"
        echo -n "TCP 缓冲: "; sysctl -n net.ipv4.tcp_rmem 2>/dev/null || echo "未知"
        echo -n "TCP 窗口: "; sysctl -n net.ipv4.tcp_wmem 2>/dev/null || echo "未知"
        echo -n "MTU 探测: "; sysctl -n net.ipv4.tcp_mtu_probing 2>/dev/null || echo "未知"
        echo -n "Fast Open: "; sysctl -n net.ipv4.tcp_fastopen 2>/dev/null || echo "未知"
        echo ""
        if [ "$2" = "enable" ]; then
            echo "启用 BBR..."
            modprobe tcp_bbr 2>/dev/null
            sysctl -w net.core.default_qdisc=fq 2>/dev/null
            sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null
            echo "✓ BBR 已启用 ($(sysctl -n net.ipv4.tcp_congestion_control))"
        fi
        ;;
    update)
        echo "更新面板..."
        cd ${INSTALL_DIR}
        git pull 2>/dev/null || echo "非 git 目录，跳过拉取"
        export NODE_ENV=development
        pnpm install 2>/dev/null || npm install
        cd web && (pnpm install 2>/dev/null || npm install) && cd ..
        npx tsup src/index.ts --format esm --target node20 --clean --sourcemap
        cd web && npx vite build && cd ..
        export NODE_ENV=production
        cd web && npx vite build 2>/dev/null && cd ..
        pm2 restart unified-panel
        echo "✓ 更新完成"
        ;;
    uninstall)
        read -p "确认卸载? 数据将被删除! [y/N]: " confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            pm2 delete unified-panel 2>/dev/null
            systemctl stop gost 2>/dev/null
            systemctl disable gost 2>/dev/null
            rm -f /etc/systemd/system/gost.service
            rm -f /etc/nginx/conf.d/unified-panel.conf
            rm -rf ${INSTALL_DIR}
            rm -f /usr/local/bin/up
            systemctl daemon-reload
            nginx -t 2>/dev/null && systemctl reload nginx
            echo "✓ 卸载完成 (3X-UI 未卸载，请手动: x-ui uninstall)"
        fi
        ;;
    *)
        echo "用法: up <命令>"
        echo ""
        echo "命令:"
        echo "  start      启动所有服务"
        echo "  stop       停止服务"
        echo "  restart    重启所有服务"
        echo "  status     查看服务状态"
        echo "  logs [n]   查看面板日志 (默认 50 行)"
        echo "  logs-gost  查看 GOST 日志"
        echo "  bbr        查看 BBR 状态 (bbr enable 启用)"
        echo "  update     更新面板代码"
        echo "  uninstall  卸载面板"
        ;;
esac
CLIEOF

    chmod +x /usr/local/bin/up
    info "管理命令已安装: up (用法: up status / up restart ...)"
}

# ============ 安装完成信息 ============
print_result() {
    PUBLIC_IPV4=$(curl -4sf --connect-timeout 3 ip.sb 2>/dev/null || curl -4sf --connect-timeout 3 ifconfig.me 2>/dev/null || echo "")
    PUBLIC_IPV6=$(curl -6sf --connect-timeout 3 ip.sb 2>/dev/null || curl -6sf --connect-timeout 3 ifconfig.me 2>/dev/null || echo "")
    PUBLIC_IP="${PUBLIC_IPV4:-${PUBLIC_IPV6:-YOUR_IP}}"

    echo ""
    divider
    echo -e "${GREEN}${BOLD}  ✓ 安装完成！${NC}"
    divider
    echo ""
    if [ -n "$PUBLIC_IPV4" ]; then
        echo -e "  ${BOLD}面板地址:${NC}     http://${PUBLIC_IPV4}:${PANEL_PORT}"
    fi
    if [ -n "$PUBLIC_IPV6" ]; then
        echo -e "  ${BOLD}面板 IPv6:${NC}    http://[${PUBLIC_IPV6}]:${PANEL_PORT}"
    fi
    if [ -z "$PUBLIC_IPV4" ] && [ -z "$PUBLIC_IPV6" ]; then
        echo -e "  ${BOLD}面板地址:${NC}     http://YOUR_IP:${PANEL_PORT}"
    fi
    echo -e "  ${BOLD}面板端口:${NC}     ${PANEL_PORT}"
    echo -e "  ${BOLD}管理员:${NC}       admin / admin123"
    echo ""
    echo -e "  ${BOLD}GOST API:${NC}     http://127.0.0.1:${GOST_API_PORT}"
    echo -e "  ${BOLD}3X-UI:${NC}        http://${PUBLIC_IPV4:-$PUBLIC_IP}:${XUI_PORT}"
    echo -e "  ${BOLD}3X-UI 账号:${NC}   admin / admin"
    echo ""
    echo -e "  ${BOLD}管理命令:${NC}"
    echo -e "    ${CYAN}up status${NC}     查看服务状态"
    echo -e "    ${CYAN}up restart${NC}    重启所有服务"
    echo -e "    ${CYAN}up logs${NC}       查看面板日志"
    echo -e "    ${CYAN}up uninstall${NC}  卸载面板"
    echo ""
    echo -e "  ${BOLD}配置文件:${NC}"
    echo -e "    面板:  ${INSTALL_DIR}/.env"
    echo -e "    GOST:  ${DATA_DIR}/gost/config.yaml"
    echo -e "    Nginx: /etc/nginx/conf.d/unified-panel.conf"
    echo ""
    BBR_CC=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo "unknown")
    echo -e "  ${BOLD}BBR:${NC}          ${BBR_CC} ($(sysctl -n net.core.default_qdisc 2>/dev/null || echo '-'))"
    echo ""
    divider
    echo -e "  ${YELLOW}⚠ 请立即修改默认密码！${NC}"
    divider
    echo ""
}

# ============ 选择安装组件 ============
select_components() {
    echo ""
    echo -e "${BOLD}选择安装组件:${NC}"
    echo "  1) 全部安装 (GOST + 3X-UI + 面板)  [推荐]"
    echo "  2) 仅 GOST + 面板 (不装 3X-UI)"
    echo "  3) 仅 3X-UI + 面板 (不装 GOST)"
    echo "  4) 仅面板 (已有 GOST 和 3X-UI)"
    echo ""
    read -p "请选择 [1-4, 默认 1]: " choice
    INSTALL_CHOICE=${choice:-1}
}

# NAT 端口范围检测
detect_nat_mode() {
    echo ""
    echo -e "${BOLD}网络环境:${NC}"
    echo "  1) 标准 VPS (有独立公网 IP，无端口限制)  [默认]"
    echo "  2) NAT VPS (共享 IP，只分配了部分端口范围)"
    echo ""
    read -p "请选择 [1-2, 默认 1]: " nat_choice

    if [ "${nat_choice}" = "2" ]; then
        read -p "允许的端口范围起始 (如 20000): " PORT_RANGE_MIN
        read -p "允许的端口范围结束 (如 30000): " PORT_RANGE_MAX
        PORT_RANGE_MIN=${PORT_RANGE_MIN:-0}
        PORT_RANGE_MAX=${PORT_RANGE_MAX:-0}

        if [ "$PORT_RANGE_MIN" -gt 0 ] 2>/dev/null && [ "$PORT_RANGE_MAX" -gt 0 ] 2>/dev/null; then
            info "NAT 模式: 端口范围 ${PORT_RANGE_MIN}-${PORT_RANGE_MAX}"

            # 自动将面板端口设到范围内
            if [ "$PANEL_PORT" -lt "$PORT_RANGE_MIN" ] || [ "$PANEL_PORT" -gt "$PORT_RANGE_MAX" ]; then
                PANEL_PORT=$PORT_RANGE_MIN
                info "面板端口自动调整为 ${PANEL_PORT}"
            fi

            # Nginx 设为面板端口 (跳过反向代理)
            NGINX_PORT=$PANEL_PORT
        fi
    fi
}

# ============ 主流程 ============
main() {
    clear
    echo -e "${CYAN}${BOLD}"
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║     统一转发管理面板 安装程序         ║"
    echo "  ║     GOST + 3X-UI + Web Panel         ║"
    echo "  ║     v1.9.0                            ║"
    echo "  ╚══════════════════════════════════════╝"
    echo -e "${NC}"

    check_system
    detect_network
    select_components
    detect_nat_mode

    install_deps
    install_nodejs
    install_pm2

    case "$INSTALL_CHOICE" in
        1)
            install_gost
            install_3xui
            ;;
        2)
            install_gost
            ;;
        3)
            install_3xui
            ;;
        4)
            info "跳过 GOST 和 3X-UI 安装"
            ;;
    esac

    deploy_panel
    setup_nginx
    setup_bbr
    setup_firewall
    install_cli
    print_result
}

main "$@"
# cache bust 1774264455
