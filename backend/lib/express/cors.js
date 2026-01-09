import { getCorsDefaults } from "../cors-config.js";

const corsDefaults = getCorsDefaults();
const isOriginAllowed = (origin) =>
	corsDefaults.allow_all_origins || corsDefaults.allow_origins.includes(origin);

export default (req, res, next) => {
	if (req.headers.origin) {
		res.set({ Vary: "Origin" });
		if (!corsDefaults.enabled || !isOriginAllowed(req.headers.origin)) {
			next();
			return;
		}
		const headers = {
			"Access-Control-Allow-Origin": req.headers.origin,
			"Access-Control-Allow-Methods": corsDefaults.allow_methods,
			"Access-Control-Allow-Headers": corsDefaults.allow_headers,
			"Access-Control-Max-Age": corsDefaults.max_age,
		};
		if (corsDefaults.allow_credentials) {
			headers["Access-Control-Allow-Credentials"] = true;
		}
		if (corsDefaults.expose_headers) {
			headers["Access-Control-Expose-Headers"] = corsDefaults.expose_headers;
		}
		res.set(headers);
		next();
	} else {
		// No origin
		next();
	}
};
