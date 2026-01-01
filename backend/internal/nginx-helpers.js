import net from "node:net";

const headerNameRegex = /^[A-Za-z0-9-]+$/;

const sanitizeHeaderValue = (value) => {
	if (!value) {
		return "";
	}
	return `${value}`.replace(/[\r\n]/g, " ").replace(/"/g, '\\"').trim();
};

const sanitizeSecurityHeaders = (headers) => {
	if (!Array.isArray(headers)) {
		return [];
	}
	const result = [];
	const seen = new Map();

	headers.forEach((header) => {
		const name = `${header?.name || ""}`.trim();
		const value = sanitizeHeaderValue(header?.value || "");
		if (!name || !value || !headerNameRegex.test(name)) {
			return;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			result[seen.get(key)].value = value;
			return;
		}
		seen.set(key, result.length);
		result.push({ name, value });
	});

	return result;
};

const mergeSecurityHeaders = (base, overrides) => {
	const merged = sanitizeSecurityHeaders(base);
	const overrideHeaders = sanitizeSecurityHeaders(overrides);
	overrideHeaders.forEach((header) => {
		const key = header.name.toLowerCase();
		const idx = merged.findIndex((existing) => existing.name.toLowerCase() === key);
		if (idx >= 0) {
			merged[idx] = header;
		} else {
			merged.push(header);
		}
	});
	return merged;
};

const hasHeader = (headers, name) =>
	Array.isArray(headers) && headers.some((header) => header?.name?.toLowerCase() === name.toLowerCase());

const isIpAddress = (host) => {
	if (!host) {
		return false;
	}
	const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return net.isIP(normalized) !== 0;
};

const sanitizeUpstreamServers = (servers) => {
	if (!Array.isArray(servers)) {
		return [];
	}
	return servers
		.map((server) => {
			const host = `${server?.host || ""}`.trim();
			const port = Number.parseInt(`${server?.port || ""}`, 10);
			if (!host || !Number.isFinite(port) || port <= 0) {
				return null;
			}
			const weight = Number.parseInt(`${server?.weight || ""}`, 10);
			const maxFails = Number.parseInt(`${server?.max_fails ?? server?.maxFails ?? ""}`, 10);
			const failTimeout = Number.parseInt(`${server?.fail_timeout ?? server?.failTimeout ?? ""}`, 10);
			return {
				host,
				port,
				weight: Number.isFinite(weight) && weight > 0 ? weight : null,
				max_fails: Number.isFinite(maxFails) && maxFails >= 0 ? maxFails : null,
				fail_timeout: Number.isFinite(failTimeout) && failTimeout >= 0 ? failTimeout : null,
				backup: server?.backup === true,
			};
		})
		.filter(Boolean);
};

export {
	sanitizeHeaderValue,
	sanitizeSecurityHeaders,
	mergeSecurityHeaders,
	hasHeader,
	isIpAddress,
	sanitizeUpstreamServers,
};
