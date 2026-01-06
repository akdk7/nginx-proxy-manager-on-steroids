# Changelog

This changelog lists commits authored by akdk7. Only commits with fuller, descriptive
messages are included (generic short messages like "Fix" or "Bug" are excluded).
Commit messages are translated to English.

## 2026-01-06 - 2.13.1-steroids.4
- Added a Docker Hub focused README with quick start, compose example, tags, and a GitHub link; added an AI assistance note.
- Introduced fork versioning with a SemVer suffix, exposed the raw version in the health API, and display it in the UI.
- Expanded CI with Yarn and Buildx caches, backend lint/tests, frontend artifact upload, and fail-fast secret checks.
- Automated Docker Hub publish on .version changes, GitHub releases with release notes, and image signing via cosign.
- Improved license compliance by adding copyright holders and including LICENSE in the image.

## 2026-01-05
- Implemented fork versioning so the app now uses its own SemVer suffix and the UI can display the full version while keeping the upstream base. (bb377af8)

## 2026-01-04
- Extended boolean normalization so tcp_forwarding/udp_forwarding are read/written correctly as true/false even when received as strings ("1", "true"). This should make the stream templates render the correct protocol blocks again. (0f9a3257)
- Moved the stream port helper functions outside the component so the useMemo dependency list is clean and Biome stops flagging getForwardingPorts. Updated TableWrapper.tsx. (38ce9da4)
- Implemented stream port-range mapping with position-matched incoming/forwarding lists, plus nginx $server_port maps and updated UI validation/help so users get precise errors for mismatches. (04e743c5)
- Renamed modal props so the entity ID no longer collides with EasyModal's internal id. The props are now hostId/streamId, so show(...) is type-safe again and your duplicate seeds keep working. (80a5b344)
- Added a duplicate action to the Proxy Host and Stream action menus. The new menu item opens the create modal prefilled with the entry values (no auto-create), so you only adjust unique fields. (75ede033)
- Turned the "on steroids" tag into a bold sticker badge: strong gradient, contrast border, slight tilt, drop shadow, and a short pop-in effect. (90ecf679)
- Added a Gitea Actions workflow that runs your local build steps on a self-hosted runner for push and pull_request (including frontend lint/test/build and Docker buildx). File: ci.yml. (e0512ccb)
- Added a GeoIP2 diagnostics check on startup (modules + GeoLite2 file) and surfaced the status in the Geo Access UI. The check runs on service start and after saving Geo Access settings to keep the display current. (49d9979e)
- Root cause was a naming mismatch between UI and backend: the UI saved httpEnabled/streamEnabled/dbPath but the backend reads http_enabled/stream_enabled/db_path. As a result the global GeoIP configuration was effectively always off. (20c6caf0)

## 2026-01-03
- GeoIP now has its own tabs for Proxy Hosts and Streams; the Advanced tab only contains the Nginx configuration. (29eba994)
- The GeoIP status column is now in the Proxy Host and Stream tables (Proxy Hosts directly to the right of Rate Limit), plus all reported lint errors are fixed. (dbc7576a)
- Added an "Apply preset" block on the global GeoIP page that applies a preset to all Proxy Hosts or all Streams with one click. The assignment uses the existing update APIs, so the respective Nginx configs are regenerated and reloaded on each update. I also adjusted the host/stream modals so missing presets are treated as "Custom" and added the new UI text. (65d919d4)
- Added a full country checklist UI everywhere and wired global presets into geo access, plus backend support so presets resolve correctly during nginx config generation. (bfbdb735)
- GeoIP2 modules are now built into the image and auto-loaded, including the runtime library. No manual root_top.conf loading is needed anymore (except for custom images). The build stages compile the modules as dynamic modules and copy them into the runtime image; libmaxminddb0 is installed and a *.conf loader is added. (2b7a4d8c)
- Implemented Geo Access Control end-to-end (DB + nginx generation + UI) so global rules and per-Proxy Host/Stream overrides are reflected in generated configs and actually enforce allow/deny by country. (0592d950)
- German locale is now fully added: UI strings are translated, German help docs are included, and the locale picker can switch to de. I wired the new locale into the runtime loader and locale checks so it behaves like the existing English setup. (e67f5aaa)
- Added a warning note on the Proxy Protocol configuration page that PROXY protocol applies per listener (port/IP), not per host. (35fdffa4)
- Stream logging is now included: a dedicated log_format in the stream context plus per-stream access/error logs for TCP and UDP. (a4f81f35)
- Stream PROXY protocol is now properly integrated: per stream you can expect PROXY headers on the listener and optionally forward them upstream (TCP only). (ffa0e168)
- Hardened config generation so missing certificates no longer produce listen ... ssl without ssl_certificate, and a broken nginx set no longer blocks saving. A broken proxy host can now be rewritten on save to fix the error. (10e8c0a0)
- Added the missing $forward_port to the default server config so nginx can parse proxy.conf even without configured hosts and the start loop stops. In default.conf, set $forward_port ":$port" is now added near the fallback variables because assets.conf includes proxy.conf and that variable otherwise does not exist on a fresh install. (71eb41ec)

## 2026-01-02
- Hardened config generation so hosts with certificate_id reload the certificate before rendering; if it is missing, it now aborts with a clear error instead of writing an invalid Nginx config (without ssl_certificate). This prevents the 'no "ssl_certificate" is defined' crash on reload and covers the path where hosts are configured without expanded certificates (e.g., via bulk regeneration). (ae39d849)
- Populated the dashboard with the items from "Immediate" and "Quick wins": (5e18c52f)
- src/pages/Logs is now imported explicitly via index.tsx so module resolution works reliably in Router.tsx. LogFileParams now has the needed index signature via StringifiableRecord so get() accepts query params in getLogFile.ts. (0ad7c547)
- Changed the heartbeat badge in the Proxy Host table to a horizontal layout and shortened it to "HB"; in the certificate list the day count now appears to the right of the expiry date. (b4d06679)
- Changed the heartbeat badge in the Proxy Host table to a horizontal layout and shortened it to "HB"; in the certificate list the day count now appears to the right of the expiry date. (0e3c081a)
- Moved the "Rate Limiting", "Security Headers", and "Upstream mTLS" sections into their own tabs in the Proxy Host edit dialog; the Advanced tab now only contains the Nginx configuration. I could not find AGENTS.md in the repo - let me know if the path is different. (8de9e4e1)
- Implemented Proxy Host listen ports as requested (comma-separated in the dialog) and updated the Nginx templates to the new listen_ports. Important logic: if a certificate is set, only port 80 stays HTTP, all other ports are treated as HTTPS; HTTP/3 stays on port 443 (only if 443 is in the list). This keeps ACME on 80 possible. (9805f52c)
- Implemented proxy_protocol globally per port and added a dynamic table in Settings so listener ports are managed centrally. The host toggle is removed, and a settings update automatically regenerates Nginx configs with the new listen parameters. (5ff4555b)
- The issue came from the id prop: ez-modal-react reserves id in InnerModalProps. I switched the modal prop to hostId. (59fa6bee)
- Added the config viewer (backend endpoints + frontend modal + new menu entries) and adjusted the load balancer port field so it no longer snaps to 0 when cleared. (1c78d03b)
- The HTTP/3 toggle is now automatically disabled when the current nginx build lacks http_v3_module. The health response adds nginx.http3_supported and the UI immediately sets the value to false when false is reported. (0fe64d0e)
- The error was that make install did not create /usr/lib/nginx in DESTDIR (because no dynamic modules were built). I removed the COPY line for /usr/lib/nginx; we now only copy the new nginx binary that includes http_v3 statically. (4dd499c6)
- The build fails because the base image reports nginx/1.27.1.2, but nginx.org has no nginx-1.27.1.2.tar.gz. I added a fallback mechanism: (a9fb1b93)
- HTTP/3/QUIC is now wired end-to-end: new http3_support field, UI toggle, API schema, and Nginx template with QUIC listens and Alt-Svc headers. (36aaea53)

## 2026-01-01
- I adjusted two things to fix the current errors and reduce memory issues: (0a0882d7)
- Adjusted the test environment so only the one hook test uses happy-dom. This significantly reduces memory usage and avoids the unsupported VM pool. (41d9fbcc)
- Switched CI tests to the VM pool and disabled isolation. The tests now run in the same process without worker threads, which should fix the OOM crash. (f04c4801)
- Made two changes to avoid OOM during vitest run in the container: (69116135)
- Traced the OOM error in vitest run to serial execution in CI: Vitest starts multiple workers (forks) by default, which can be ~4 GB heap per worker in the container and crash. I set CI tests to 1 worker and disabled file parallelism. (e9e62c16)
- Added tests and moved pure logic into small helper modules so tests can run without DB/Express boot. The heartbeat hook was split into its own hook and upstream validation moved into a lightweight module to keep frontend tests isolated. (eb02cb32)
- Made all heartbeat badges clickable and wired the "active check". Clicking a load balancer heartbeat also triggers the forward host heartbeat. (78feaf81)
- Heartbeat on Load Balancers (7bd1855c)
- Solved it cleanly: AJV now knows ipv4/ipv6/hostname and the stream schema uses these formats correctly. The "unknown format ... ignored" warnings disappear and validation actually works. Changes in api.js, index.js, stream-object.json, package.json, yarn.lock. (d81dcfdf)
- Certificates Expired now shows remaining days. (b247ac59)
- Made two changes so the Admin UI (port 81) stays reachable even with broken host configs and the restart loop stops. Changes in proxy_host.conf, stream.conf, nginx.js, docker/rootfs/etc/s6-overlay/s6-rc.d/nginx/run. (e0d545a7)
- Changed two things so the loop stops on invalid configuration and hostnames in streams no longer block startup: (26ad447f)
- Adjusted upstream DNS resolution so Nginx no longer hard-fails on unresolved hosts (avoiding a start loop). Changes in nginx.js, stream.conf, proxy_host.conf, nginx.conf. (a07dd96a)
- Nginx configuration regeneration is more robust. (bf0fb996)
- Implemented load balancing for streams while avoiding proxy host pitfalls (no enableReinitialize, custom validation, clear error messages, upstream fields are highlighted). This included backend/schema/template changes. (5f2e5a5a)
- Stream heartbeats include "unsupported" for UDP, upstream pools with policy/UI, combinable security header presets, optional upstream mTLS, and certificate expiry in overviews; plus header sanitizing so CSP/HSTS semicolons are preserved and upstream inputs sync cleanly to forwardHost/Port. (8ca81c31)
- Heartbeat checks are now available in the backend and shown in the Proxy Hosts overview and the edit/create dialog; in the dialog, entering scheme/host/port triggers a single debounced check shown as a label. This adds a new API endpoint with timeout/cache, a status formatter with badge/popover in the overview, and the necessary API/type/locale wiring. (d67df435)
- The error occurs because an nginx -s reload runs during early startup even though Nginx is not running (PID file empty). I fixed it so the regenerate path only reloads when Nginx is actually running. (36aa1c4a)
- Added an env var to rebuild all Nginx configs on startup: (9a3cb56e)
- Cause: in rate_limit.conf the zone size was rendered via zone.size. Liquid treats size specially (returns the number of keys), which produced zone=... without a valid size -> zero size shared memory zone. (540b36b2)
- Implemented rate limiting for Proxy Hosts and Locations: new DB fields + schema, Nginx zone generation, and UI controls (host-level in the Advanced tab, location-level in the location advanced section). (7e78f087)
- Tighten CORS allowlist and upload limits - Require explicit CORS_ORIGINS (or *) instead of default-allow. - Add FILE_UPLOAD_LIMIT_FILES to cap multipart file count alongside size. (869d442b)
- Harden API CORS and uploads. (b7a72d27)
