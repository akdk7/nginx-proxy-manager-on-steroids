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
	return errors;
};
