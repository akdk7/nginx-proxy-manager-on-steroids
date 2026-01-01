import assert from "node:assert/strict";
import test from "node:test";
import {
	isIpAddress,
	mergeSecurityHeaders,
	sanitizeSecurityHeaders,
	sanitizeUpstreamServers,
} from "../../internal/nginx-helpers.js";

test("sanitizeSecurityHeaders filters invalid entries and de-duplicates by name", () => {
	const result = sanitizeSecurityHeaders([
		{ name: "X-Test", value: "one" },
		{ name: "X-Test", value: "two" },
		{ name: "Invalid Header", value: "nope" },
		{ name: "X-CRLF", value: "a\r\nb" },
		{ name: "X-Quote", value: 'a"b' },
	]);

	const entries = Object.fromEntries(result.map((header) => [header.name, header.value]));

	assert.equal(result.length, 3);
	assert.equal(entries["X-Test"], "two");
	assert.equal(entries["X-CRLF"], "a  b");
	assert.equal(entries["X-Quote"], 'a\\"b');
});

test("mergeSecurityHeaders overrides case-insensitive matches", () => {
	const merged = mergeSecurityHeaders(
		[
			{ name: "X-One", value: "1" },
			{ name: "X-Two", value: "2" },
		],
		[
			{ name: "x-two", value: "3" },
			{ name: "X-Three", value: "4" },
		],
	);

	const entries = Object.fromEntries(merged.map((header) => [header.name.toLowerCase(), header.value]));

	assert.equal(merged.length, 3);
	assert.equal(entries["x-one"], "1");
	assert.equal(entries["x-two"], "3");
	assert.equal(entries["x-three"], "4");
});

test("sanitizeUpstreamServers normalizes values and filters invalid servers", () => {
	const result = sanitizeUpstreamServers([
		{
			host: "example.com",
			port: "80",
			weight: "2",
			max_fails: "0",
			fail_timeout: "10",
			backup: true,
		},
		{ host: "", port: 80 },
		{ host: "invalid", port: "bad" },
	]);

	assert.equal(result.length, 1);
	assert.deepEqual(result[0], {
		host: "example.com",
		port: 80,
		weight: 2,
		max_fails: 0,
		fail_timeout: 10,
		backup: true,
	});
});

test("isIpAddress detects IPv4 and IPv6 literals", () => {
	assert.equal(isIpAddress("1.2.3.4"), true);
	assert.equal(isIpAddress("[::1]"), true);
	assert.equal(isIpAddress("example.com"), false);
});
