import assert from "node:assert/strict";
import test from "node:test";
import {
	checkHostnameRecordsTaken,
	cleanAllRowsCertificateMeta,
	getHostsWithDomains,
} from "../../internal/host-helpers.js";

test("cleanAllRowsCertificateMeta strips certificate meta from all rows", () => {
	const rows = [
		{
			certificate: {
				meta: { foo: "bar" },
			},
		},
		{
			certificate: null,
		},
	];

	const result = cleanAllRowsCertificateMeta(rows);

	assert.deepEqual(result[0].certificate.meta, {});
	assert.equal(result[1].certificate, null);
});

test("_checkHostnameRecordsTaken is case-insensitive and respects ignoreId", () => {
	const rows = [
		{
			id: 1,
			domain_names: ["Example.com", "Other.test"],
		},
	];

	assert.equal(checkHostnameRecordsTaken("example.com", rows), true);
	assert.equal(checkHostnameRecordsTaken("example.com", rows, 1), false);
	assert.equal(checkHostnameRecordsTaken("missing.com", rows), false);
});

test("_getHostsWithDomains matches domains via set membership", () => {
	const hosts = [
		{ id: 1, domain_names: ["a.example", "b.example"] },
		{ id: 2, domain_names: ["c.example"] },
		{ id: 3, domain_names: null },
	];

	const result = getHostsWithDomains(hosts, ["B.EXAMPLE", "d.example"]);

	assert.equal(result.length, 1);
	assert.equal(result[0].id, 1);
});
