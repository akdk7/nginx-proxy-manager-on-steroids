const parsePortToken = (token: string) => {
	const trimmed = token.trim();
	if (!trimmed) {
		return { ports: [], valid: false, start: 0, end: 0 };
	}

	if (trimmed.includes("-")) {
		const parts = trimmed.split("-").map((part) => part.trim());
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			return { ports: [], valid: false, start: 0, end: 0 };
		}
		const start = Number.parseInt(parts[0], 10);
		const end = Number.parseInt(parts[1], 10);
		if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end > 65535 || start > end) {
			return { ports: [], valid: false, start: 0, end: 0 };
		}
		const ports = [];
		for (let port = start; port <= end; port += 1) {
			ports.push(port);
		}
		return { ports, valid: true, start, end };
	}

	const port = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(port) || port < 1 || port > 65535) {
		return { ports: [], valid: false, start: 0, end: 0 };
	}
	return { ports: [port], valid: true, start: port, end: port };
};

const normalizePorts = (ports: number[]) => {
	const unique = new Set<number>();
	const ordered: number[] = [];
	ports.forEach((port) => {
		const parsed = Number.parseInt(`${port}`, 10);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535 && !unique.has(parsed)) {
			unique.add(parsed);
			ordered.push(parsed);
		}
	});
	return ordered;
};

const parsePortRanges = (value: string) => {
	const raw = `${value || ""}`.trim();
	if (!raw) {
		return { ports: [], hasValue: false, hasInvalid: false };
	}
	const tokens = raw.split(",").map((token) => token.trim()).filter(Boolean);
	const ports: number[] = [];
	let hasInvalid = false;
	tokens.forEach((token) => {
		const result = parsePortToken(token);
		if (!result.valid) {
			hasInvalid = true;
			return;
		}
		ports.push(...result.ports);
	});
	return { ports, hasValue: true, hasInvalid };
};

const parsePortSegments = (value: string) => {
	const raw = `${value || ""}`.trim();
	if (!raw) {
		return {
			segments: [],
			ports: [],
			hasValue: false,
			invalidTokens: [],
			hasDuplicates: false,
		};
	}
	const tokens = raw.split(",").map((token) => token.trim()).filter(Boolean);
	const ports: number[] = [];
	const segments: Array<{ token: string; start: number; end: number; ports: number[] }> = [];
	const invalidTokens: Array<{ token: string; index: number }> = [];
	tokens.forEach((token, index) => {
		const result = parsePortToken(token);
		if (!result.valid) {
			invalidTokens.push({ token, index: index + 1 });
			return;
		}
		segments.push({ token, start: result.start, end: result.end, ports: result.ports });
		ports.push(...result.ports);
	});
	const uniquePorts = normalizePorts(ports);
	const hasDuplicates = uniquePorts.length !== ports.length;
	return {
		segments,
		ports,
		hasValue: true,
		invalidTokens,
		hasDuplicates,
	};
};

const formatPortRanges = (ports: number[]) => {
	const normalized = ports.filter((port) => Number.isFinite(port) && port >= 1 && port <= 65535);
	if (!normalized.length) {
		return "";
	}
	const ranges = [];
	let rangeStart = normalized[0];
	let previous = normalized[0];

	for (let i = 1; i < normalized.length; i += 1) {
		const current = normalized[i];
		if (current === previous + 1) {
			previous = current;
			continue;
		}
		ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
		rangeStart = current;
		previous = current;
	}
	ranges.push(rangeStart === previous ? `${rangeStart}` : `${rangeStart}-${previous}`);
	return ranges.join(", ");
};

export { formatPortRanges, parsePortRanges, parsePortSegments };
