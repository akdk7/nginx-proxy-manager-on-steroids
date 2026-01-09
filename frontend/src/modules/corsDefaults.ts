import type { CorsConfig } from "src/api/backend";

const defaultCorsConfig: CorsConfig = {
	enabled: true,
	allowOrigins: [],
	allowMethods: "OPTIONS, GET, POST, PUT, DELETE, PATCH",
	allowHeaders:
		"Content-Type, Cache-Control, Pragma, Expires, Authorization, X-Dataset-Total, X-Dataset-Offset, X-Dataset-Limit",
	exposeHeaders: "X-Dataset-Total, X-Dataset-Offset, X-Dataset-Limit",
	allowCredentials: true,
	maxAge: 5 * 60,
};

export { defaultCorsConfig };
