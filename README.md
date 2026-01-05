![Nginx Proxy Manager on Steroids](assets/logo.png)

# Nginx Proxy Manager on Steroids

This image is a feature-rich fork of the original
[Nginx Proxy Manager](https://github.com/NginxProxyManager/nginx-proxy-manager).
It keeps the familiar UI and workflow, but adds power-user features for
geo access control, stream load balancing, HTTP/3, and more.

GitHub repo (source, issues, docs):
https://github.com/akdk7/nginx-proxy-manager-on-steroids

## Highlights

- GeoIP2-based Geo Access Control with global and per host/stream rules
- Stream load balancing with upstream pools and policies
- Stream multi-port and port-ranges
- PROXY protocol support and per-stream access/error logs
- Heartbeat checks for proxy hosts and streams with status badges
- Rate limiting for proxy hosts and locations
- Security header presets and optional upstream mTLS
- Configurable PROXY protocol per listener port
- HTTP/3/QUIC support with automatic disable when the module is unavailable
- Logs UI and generated Nginx config viewer
- Dashboard widgets for host status, certificate expiry, and recent activity
- German locale with translated help docs
- Hardened CORS and upload limits

## Quick start (Docker)

```bash
docker run -d \
  --name npm-on-steroids \
  -p 80:80 \
  -p 81:81 \
  -p 443:443 \
  -v ./data:/data \
  -v ./letsencrypt:/etc/letsencrypt \
  akdk7/nginx-proxy-manager-on-steroids:latest
```

Open the admin UI:
http://127.0.0.1:81

## Docker Compose

```yml
services:
  app:
    image: 'akdk7/nginx-proxy-manager-on-steroids:latest'
    restart: unless-stopped
    ports:
      - '80:80'
      - '81:81'
      - '443:443'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

## Tags and versioning

The build publishes multiple tags:

- `latest` points to the most recent release
- `2.13.1` matches the upstream base version from `.version`
- `2.13.1-steroids.0` matches the fork release from `backend/package.json`

## Notes

- This project is a fork of the original upstream. The UI and core workflows
  remain familiar, while the fork adds advanced features.
- Portions of this fork were developed with AI assistance.
- For build instructions and deeper docs, see the GitHub repo.

## License

MIT
