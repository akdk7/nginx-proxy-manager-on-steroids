import http from "node:http";
import https from "node:https";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_CACHE_TTL_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = Number.parseInt(process.env.PROXY_HOST_HEARTBEAT_TIMEOUT_MS || "", 10);
const HEARTBEAT_CACHE_TTL_MS = Number.parseInt(process.env.PROXY_HOST_HEARTBEAT_CACHE_TTL_MS || "", 10);
const timeoutMs = Number.isFinite(HEARTBEAT_TIMEOUT_MS) && HEARTBEAT_TIMEOUT_MS > 0 ? HEARTBEAT_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
const cacheTtlMs =
	Number.isFinite(HEARTBEAT_CACHE_TTL_MS) && HEARTBEAT_CACHE_TTL_MS > 0
		? HEARTBEAT_CACHE_TTL_MS
		: DEFAULT_CACHE_TTL_MS;

const heartbeatCache = new Map();

const buildProxyCacheKey = (host) => `proxy:${host.forward_scheme}://${host.forward_host}:${host.forward_port}`;
const buildStreamCacheKey = (host) =>
	`stream:${host.forwarding_host}:${host.forwarding_port}:${host.tcp_forwarding ? "tcp" : "no-tcp"}:${host.udp_forwarding ? "udp" : "no-udp"}`;

const buildOptions = (host) => {
	const options = {
		hostname: host.forward_host,
		port: host.forward_port,
		path: "/",
		method: "HEAD",
		headers: {
			Host: host.forward_host,
		},
	};

	const ipVersion = net.isIP(host.forward_host);
	if (ipVersion === 6) {
		options.family = 6;
	}

	if (host.forward_scheme === "https") {
		options.rejectUnauthorized = false;
	}

	return options;
};

const probeHost = (host) =>
	new Promise((resolve) => {
		const now = Date.now();
		const client = host.forward_scheme === "https" ? https : http;
		const options = buildOptions(host);
		const request = client.request(options, (res) => {
			const location = typeof res.headers?.location === "string" ? res.headers.location : null;
			let redirectedToScheme = null;
			if (location && res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
				try {
					const url = new URL(location, `${host.forward_scheme}://${host.forward_host}`);
					const scheme = url.protocol?.replace(":", "");
					if (scheme && scheme !== host.forward_scheme && (scheme === "http" || scheme === "https")) {
						redirectedToScheme = scheme;
					}
				} catch {
					// Ignore invalid redirect URLs.
				}
			}

			res.resume();
			resolve({
				ok: true,
				status_code: res.statusCode ?? null,
				redirected_to_scheme: redirectedToScheme,
				latency_ms: Date.now() - now,
				checked_at: new Date().toISOString(),
				status: "ok",
			});
		});

		request.setTimeout(timeoutMs, () => {
			request.destroy(new Error("timeout"));
		});

		request.on("error", (err) => {
			resolve({
				ok: false,
				error: err?.message || "Heartbeat failed",
				latency_ms: Date.now() - now,
				checked_at: new Date().toISOString(),
				status: "failed",
			});
		});

		request.end();
	});

const probeTcp = (host) =>
	new Promise((resolve) => {
		const now = Date.now();
		const socket = new net.Socket();
		let settled = false;

		const finish = (result) => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolve(result);
		};

		socket.setTimeout(timeoutMs, () => {
			finish({
				ok: false,
				error: "timeout",
				latency_ms: Date.now() - now,
				checked_at: new Date().toISOString(),
				status: "failed",
			});
		});

		socket.on("error", (err) => {
			finish({
				ok: false,
				error: err?.message || "Heartbeat failed",
				latency_ms: Date.now() - now,
				checked_at: new Date().toISOString(),
				status: "failed",
			});
		});

		socket.connect(host.forwarding_port, host.forwarding_host, () => {
			finish({
				ok: true,
				latency_ms: Date.now() - now,
				checked_at: new Date().toISOString(),
				status: "ok",
			});
		});
	});

const checkProxyHost = async (host) => {
	const cacheKey = buildProxyCacheKey(host);
	const cached = heartbeatCache.get(cacheKey);
	if (cached && cached.expires_at > Date.now()) {
		return cached.result;
	}
	if (cached) {
		heartbeatCache.delete(cacheKey);
	}
	const result = await probeHost(host);
	heartbeatCache.set(cacheKey, {
		expires_at: Date.now() + cacheTtlMs,
		result: result,
	});
	return result;
};

const checkStream = async (host) => {
	if (!host.tcp_forwarding && host.udp_forwarding) {
		return {
			ok: false,
			error: "UDP heartbeat not supported",
			checked_at: new Date().toISOString(),
			status: "unsupported",
		};
	}
	if (!host.tcp_forwarding && !host.udp_forwarding) {
		return {
			ok: false,
			error: "No protocol configured",
			checked_at: new Date().toISOString(),
			status: "unsupported",
		};
	}
	const cacheKey = buildStreamCacheKey(host);
	const cached = heartbeatCache.get(cacheKey);
	if (cached && cached.expires_at > Date.now()) {
		return cached.result;
	}
	if (cached) {
		heartbeatCache.delete(cacheKey);
	}
	const result = await probeTcp(host);
	heartbeatCache.set(cacheKey, {
		expires_at: Date.now() + cacheTtlMs,
		result: result,
	});
	return result;
};

const internalHeartbeat = {
	checkProxyHosts: async (hosts) => {
		const results = await Promise.all(
			hosts.map(async (host) => {
				const result = await checkProxyHost(host);
				if (typeof host.id !== "undefined") {
					return { id: host.id, ...result };
				}
				return result;
			}),
		);
		return results;
	},
	checkStreams: async (hosts) => {
		const results = await Promise.all(
			hosts.map(async (host) => {
				const result = await checkStream(host);
				if (typeof host.id !== "undefined") {
					return { id: host.id, ...result };
				}
				return result;
			}),
		);
		return results;
	},
};

export default internalHeartbeat;
