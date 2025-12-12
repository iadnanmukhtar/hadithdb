## Elasticsearch restart cron (Ubuntu)

1) Make the restart script executable (run once):
```
chmod +x /path/to/repo/bin/restart-elasticsearch.sh
```

2) Add a root cron entry so it runs every 6 hours:
```
sudo crontab -e
```
Add this line (adjust the path if your repo lives elsewhere):
```
0 */6 * * * /usr/bin/env bash /path/to/repo/bin/restart-elasticsearch.sh >> /var/log/elasticsearch-restart.log 2>&1
```

3) Confirm it works:
```
/usr/bin/env bash /path/to/repo/bin/restart-elasticsearch.sh
sudo systemctl status elasticsearch
```

Notes:
- Cron uses a minimal PATH, so the entry calls `/usr/bin/env bash` explicitly.
- The log redirection keeps a basic history in `/var/log/elasticsearch-restart.log`; adjust or remove if you prefer syslog instead.
