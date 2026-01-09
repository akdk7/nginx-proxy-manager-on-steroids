const defaultCorsConfig = {
	allow_methods: "OPTIONS, GET, POST, PUT, DELETE, PATCH",
	allow_headers:
		"Content-Type, Cache-Control, Pragma, Expires, Authorization, X-Dataset-Total, X-Dataset-Offset, X-Dataset-Limit",
	expose_headers: "X-Dataset-Total, X-Dataset-Offset, X-Dataset-Limit",
	allow_credentials: true,
	max_age: 5 * 60,
};

const sanitizeHeaderValue = (value) => {
	if (!value) {
		return "";
	}
	return `${value}`.replace(/[\r\n]/g, " ").replace(/"/g, '\\"').trim();
};

const normalizeOrigins = (value, fallback) => {
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(",")
			: Array.isArray(fallback)
				? fallback
				: [];
	return raw
		.map((origin) => `${origin}`.replace(/[\r\n]/g, "").replace(/"/g, "").trim())
		.filter(Boolean);
};

const normalizeHeaderList = (value, fallback, allowEmpty = false) => {
	if (Array.isArray(value)) {
		value = value.join(", ");
	}
	if (typeof value !== "string") {
		return sanitizeHeaderValue(fallback || "");
	}
	const normalized = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.join(", ");
	if (!normalized && allowEmpty) {
		return "";
	}
	if (!normalized) {
		return sanitizeHeaderValue(fallback || "");
	}
	return sanitizeHeaderValue(normalized);
};

const normalizeBoolean = (value, fallback) => {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "number") {
		return value !== 0;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["1", "true", "yes", "on"].includes(normalized)) {
			return true;
		}
		if (["0", "false", "no", "off"].includes(normalized)) {
			return false;
		}
	}
	return fallback;
};

const normalizeMaxAge = (value, fallback) => {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return fallback;
};

const normalizeCorsConfig = (config = {}, defaults = defaultCorsConfig) => {
	const hasCustomOrigins = typeof config.allow_origins !== "undefined";
	const allowOrigins = normalizeOrigins(
		hasCustomOrigins ? config.allow_origins : defaults.allow_origins,
		defaults.allow_origins,
	);
	let allowAllOrigins = allowOrigins.includes("*");
	if (!hasCustomOrigins && defaults.allow_all_origins) {
		allowAllOrigins = true;
	}
	const filteredOrigins = allowOrigins.filter((origin) => origin !== "*");
	const allowMethods = normalizeHeaderList(config.allow_methods, defaults.allow_methods);
	const allowHeaders = normalizeHeaderList(config.allow_headers, defaults.allow_headers);
	const exposeHeaders = normalizeHeaderList(config.expose_headers, defaults.expose_headers, true);
	const allowCredentials = normalizeBoolean(config.allow_credentials, defaults.allow_credentials);
	const maxAge = normalizeMaxAge(config.max_age, defaults.max_age);
	let enabled = normalizeBoolean(config.enabled, undefined);
	if (typeof enabled !== "boolean") {
		enabled = typeof defaults.enabled === "boolean" ? defaults.enabled : undefined;
	}
	if (typeof enabled !== "boolean") {
		enabled = allowAllOrigins || filteredOrigins.length > 0;
	}
	if (!enabled || (!allowAllOrigins && filteredOrigins.length === 0)) {
		return {
			enabled: false,
			allow_all_origins: false,
			allow_origins: [],
			allow_methods: allowMethods,
			allow_headers: allowHeaders,
			expose_headers: exposeHeaders,
			allow_credentials: allowCredentials,
			max_age: maxAge,
		};
	}
	return {
		enabled: true,
		allow_all_origins: allowAllOrigins,
		allow_origins: filteredOrigins,
		allow_methods: allowMethods,
		allow_headers: allowHeaders,
		expose_headers: exposeHeaders,
		allow_credentials: allowCredentials,
		max_age: maxAge,
	};
};

const getCorsDefaults = () => {
	return normalizeCorsConfig(
		{
			allow_origins: normalizeOrigins(process.env.CORS_ORIGINS || "", []),
			allow_methods: process.env.CORS_ALLOW_METHODS,
			allow_headers: process.env.CORS_ALLOW_HEADERS,
			expose_headers: process.env.CORS_EXPOSE_HEADERS,
			allow_credentials: process.env.CORS_ALLOW_CREDENTIALS,
			max_age: process.env.CORS_MAX_AGE,
		},
		defaultCorsConfig,
	);
};

export { defaultCorsConfig, getCorsDefaults, normalizeCorsConfig };
