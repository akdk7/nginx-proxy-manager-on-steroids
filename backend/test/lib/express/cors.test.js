import assert from "node:assert/strict";
import test from "node:test";

const importCors = async (origins) => {
	if (typeof origins === "string") {
		process.env.CORS_ORIGINS = origins;
	} else {
		delete process.env.CORS_ORIGINS;
	}
	const moduleUrl = new URL("../../../lib/express/cors.js", import.meta.url);
	moduleUrl.search = `?t=${Math.random()}`;
	const mod = await import(moduleUrl.href);
	return mod.default;
};

const createReqRes = (origin) => {
	const headers = {};
	const req = { headers: origin ? { origin } : {} };
	const res = {
		headers,
		set: (values) => Object.assign(headers, values),
	};
	let nextCalled = false;
	const next = () => {
		nextCalled = true;
	};
	return { req, res, headers, next, get nextCalled() { return nextCalled; } };
};

test("allows configured origins", { concurrency: false }, async () => {
	const cors = await importCors("https://allowed.test, https://other.test");
	const ctx = createReqRes("https://allowed.test");

	cors(ctx.req, ctx.res, ctx.next);

	assert.equal(ctx.nextCalled, true);
	assert.equal(ctx.headers["Access-Control-Allow-Origin"], "https://allowed.test");
	assert.equal(ctx.headers["Access-Control-Allow-Credentials"], true);
	assert.equal(ctx.headers.Vary, "Origin");
});

test("does not expose headers for disallowed origins", { concurrency: false }, async () => {
	const cors = await importCors("https://allowed.test");
	const ctx = createReqRes("https://denied.test");

	cors(ctx.req, ctx.res, ctx.next);

	assert.equal(ctx.nextCalled, true);
	assert.equal(ctx.headers.Vary, "Origin");
	assert.equal(ctx.headers["Access-Control-Allow-Origin"], undefined);
});

test("allows all origins with wildcard configuration", { concurrency: false }, async () => {
	const cors = await importCors("*");
	const ctx = createReqRes("https://anywhere.test");

	cors(ctx.req, ctx.res, ctx.next);

	assert.equal(ctx.nextCalled, true);
	assert.equal(ctx.headers["Access-Control-Allow-Origin"], "https://anywhere.test");
});

test("does nothing when no origin is present", { concurrency: false }, async () => {
	const cors = await importCors("https://allowed.test");
	const ctx = createReqRes(undefined);

	cors(ctx.req, ctx.res, ctx.next);

	assert.equal(ctx.nextCalled, true);
	assert.equal(Object.keys(ctx.headers).length, 0);
});
