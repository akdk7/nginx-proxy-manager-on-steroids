## Important notice

This project is a fork of the original github repo [nginx-proxy-manager](https://github.com/NginxProxyManager/nginx-proxy-manager).

All changes were done by ChatGPT. I simply wanted to find out if it's possible to expand this project with as many features as possible. :)

## Features original project

- Beautiful and Secure Admin Interface based on [Tabler](https://tabler.github.io/)
- Easily create forwarding domains, redirections, streams and 404 hosts without knowing anything about Nginx
- Free SSL using Let's Encrypt or provide your own custom SSL certificates
- Access Lists and basic HTTP Authentication for your hosts
- Advanced Nginx configuration available for super users
- User management, permissions and audit log

### Feature in nginx-proxy-manager-on-steroids

- GeoIP2-based Geo Access Control with global and per host/stream rules, country checklist, and presets
- GeoIP2 diagnostics in the UI plus bundled modules that auto-load in the official image
- Stream load balancing with upstream pools and policies
- Stream multi-port and port-ranges
- Stream PROXY protocol support and per-stream access/error logs
- Heartbeat checks for proxy hosts and streams with status badges
- Rate limiting for proxy hosts and locations
- Security header presets and optional upstream mTLS
- Configurable PROXY protocol per listener port
- HTTP/3/QUIC support with automatic disable when the module is unavailable
- Logs UI and generated Nginx config viewer
- Dashboard widgets for host status, certificate expiry, and recent activity
- German locale with translated help docs
- Hardened CORS and upload limits


## Quick Setup

1. Install Docker and Docker-Compose

- [Docker Install documentation](https://docs.docker.com/install/)
- [Docker-Compose Install documentation](https://docs.docker.com/compose/install/)

2. Clone this repo

Create a bash-file build.sh somewhere and put this content into it. Change permission `chmod +x build.sh`. Execute the script `./build.sh`.

```bash
#!/usr/bin/env bash
set -euo pipefail

cd CHANGE_TO_GIT_REPO
git pull --ff-only
./scripts/ci/frontend-build
docker buildx build -f docker/Dockerfile --platform linux/amd64 -t nginx-proxy-manager:local --load . --no-cache
```

3. Create a docker-compose.yml file similar to this:

```yml
services:
  app:
    image: 'nginx-proxy-manager:local'
    restart: unless-stopped
    ports:
      - '80:80'
      - '81:81'
      - '443:443'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

This is the bare minimum configuration required. See the [documentation](https://nginxproxymanager.com/setup/) for more.

3. Bring up your stack by running

```bash
docker compose up -d
```

4. Log in to the Admin UI

When your docker container is running, connect to it on port `81` for the admin interface.
Sometimes this can take a little bit because of the entropy of keys.

[http://127.0.0.1:81](http://127.0.0.1:81)

