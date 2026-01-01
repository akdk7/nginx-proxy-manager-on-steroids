import { describe, expect, it } from "vitest";
import { validateUpstreamServers } from "./proxyHostValidation";

describe("validateUpstreamServers", () => {
	it("requires a valid upstream server when enabled", () => {
		const errors = validateUpstreamServers({
			upstreamEnabled: true,
			upstreamServers: [{ host: "", port: 0 }],
		});

		expect(errors.upstreamServers).toBe("error.upstream-required");
	});

	it("accepts a valid upstream server when enabled", () => {
		const errors = validateUpstreamServers({
			upstreamEnabled: true,
			upstreamServers: [{ host: "example.local", port: 8080 }],
		});

		expect(errors.upstreamServers).toBeUndefined();
	});

	it("does not enforce upstream servers when disabled", () => {
		const errors = validateUpstreamServers({
			upstreamEnabled: false,
			upstreamServers: [],
		});

		expect(errors.upstreamServers).toBeUndefined();
	});
});
