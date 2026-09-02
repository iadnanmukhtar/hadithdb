'use strict';

module.exports = {
  apps: [
    {
      name: 'hadithdb',
      script: './bin/www',
      cwd: '/home/adnanmukhtar/hadithdb',
      interpreter: '/home/linuxbrew/.linuxbrew/bin/node',
      node_args: '-r dotenv/config -r newrelic',
      instances: 2,
      exec_mode: 'fork',
      increment_var: 'PORT',
      instance_var: 'NODE_APP_INSTANCE',
      merge_logs: true,
      out_file: '/home/adnanmukhtar/.pm2/logs/hadithdb-out.log',
      error_file: '/home/adnanmukhtar/.pm2/logs/hadithdb-error.log',
      autorestart: true,
      restart_delay: 1000,
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 180000,
      env: {
        PORT: 3004
      }
    }
  ]
};
