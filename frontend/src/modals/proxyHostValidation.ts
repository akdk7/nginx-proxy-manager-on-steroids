import { intl } from "src/locale";

const validateListenPorts = (value: unknown): string | undefined => {
	if (typeof value === "undefined" || value === null) {
		return undefined;
	}
	const raw = `${value}`.trim();
	if (!raw) {
		return intl.formatMessage({ id: "error.required" });
	}
	const parts = raw
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	if (!parts.length) {
		return intl.formatMessage({ id: "error.required" });
	}
	const seen = new Set<number>();
	for (const part of parts) {
		const parsed = Number.parseInt(part, 10);
		if (!Number.isFinite(parsed)) {
			return intl.formatMessage({ id: "error.invalid-port" });
		}
		if (parsed < 1) {
			return intl.formatMessage({ id: "error.minimum" }, { min: 1 });
		}
		if (parsed > 65535) {
			return intl.formatMessage({ id: "error.maximum" }, { max: 65535 });
		}
		if (seen.has(parsed)) {
			return intl.formatMessage({ id: "error.duplicate-port" });
		}
		seen.add(parsed);
	}
	return undefined;
};

export const validateUpstreamServers = (values: any) => {
	const errors: Record<string, string> = {};
	if (values?.upstreamEnabled) {
		const servers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
		const hasValidServer = servers.some((server: any) => {
			const host = `${server?.host || ""}`.trim();
			const port = Number.parseInt(`${server?.port || ""}`, 10);
			return host && Number.isFinite(port) && port > 0;
		});
		if (!hasValidServer) {
			errors.upstreamServers = "error.upstream-required";
		}
	}
	const listenPortsError = validateListenPorts(values?.listenPorts);
	if (listenPortsError) {
		errors.listenPorts = listenPortsError;
	}
	return errors;
};
