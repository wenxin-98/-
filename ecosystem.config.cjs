// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'unified-panel',
    script: 'dist/index.js',
    cwd: process.env.INSTALL_DIR || '/opt/unified-panel',
    node_args: '--experimental-specifier-resolution=node',
    env: {
      NODE_ENV: 'production',
    },
    instances: 1,
    autorestart: true,
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/opt/unified-panel/logs/pm2-error.log',
    out_file: '/opt/unified-panel/logs/pm2-out.log',
    merge_logs: true,
  }],
};
