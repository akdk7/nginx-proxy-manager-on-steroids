import assert from "node:assert/strict";
import test from "node:test";
import { createSetup } from "../setup-helpers.js";

const createUserModel = (firstResult = null) => {
	const calls = {
		select: 0,
		where: 0,
		first: 0,
		insertAndFetch: [],
	};

	const query = {
		select: () => {
			calls.select += 1;
			return query;
		},
		where: () => {
			calls.where += 1;
			return query;
		},
		first: async () => {
			calls.first += 1;
			return firstResult;
		},
		insertAndFetch: async (data) => {
			calls.insertAndFetch.push(data);
			return { id: 42, ...data };
		},
	};

	return { model: { query: () => query }, calls };
};

const createInsertModel = () => {
	const calls = [];
	return {
		model: {
			query: () => ({
				insert: async (data) => {
					calls.push(data);
					return data;
				},
			}),
		},
		calls,
	};
};

const createNoopSetup = (userModel) => {
	const auth = createInsertModel();
	const perms = createInsertModel();
	const noopModel = { query: () => ({ where: () => ({ andWhere: async () => [] }) }) };
	const settingModel = { query: () => ({ select: () => ({ where: () => ({ first: async () => null }) }) }) };

	const setup = createSetup({
		userModel,
		authModel: auth.model,
		userPermissionModel: perms.model,
		settingModel,
		certificateModel: noopModel,
		installPlugins: async () => {},
		utils: { exec: async () => {} },
		logger: { info: () => {}, warn: () => {} },
	});

	return { setup, auth, perms };
};

test("setupDefaultUser is a no-op without env vars", { concurrency: false }, async (t) => {
	delete process.env.INITIAL_ADMIN_EMAIL;
	delete process.env.INITIAL_ADMIN_PASSWORD;
	t.after(() => {
		delete process.env.INITIAL_ADMIN_EMAIL;
		delete process.env.INITIAL_ADMIN_PASSWORD;
	});

	const { model: userModel, calls } = createUserModel(null);
	const { setup } = createNoopSetup(userModel);

	await setup.setupDefaultUser();

	assert.equal(calls.insertAndFetch.length, 0);
	assert.equal(calls.select, 0);
});

test("setupDefaultUser creates an admin when none exists", { concurrency: false }, async (t) => {
	process.env.INITIAL_ADMIN_EMAIL = "admin@example.com";
	process.env.INITIAL_ADMIN_PASSWORD = "secret";
	t.after(() => {
		delete process.env.INITIAL_ADMIN_EMAIL;
		delete process.env.INITIAL_ADMIN_PASSWORD;
	});

	const { model: userModel, calls } = createUserModel(null);
	const { setup, auth, perms } = createNoopSetup(userModel);

	await setup.setupDefaultUser();

	assert.equal(calls.insertAndFetch.length, 1);
	assert.equal(calls.insertAndFetch[0].email, "admin@example.com");
	assert.deepEqual(calls.insertAndFetch[0].roles, ["admin"]);
	assert.equal(auth.calls.length, 1);
	assert.equal(auth.calls[0].secret, "secret");
	assert.equal(perms.calls.length, 1);
	assert.equal(perms.calls[0].user_id, 42);
});

test("setupDefaultUser skips creation when a user exists", { concurrency: false }, async (t) => {
	process.env.INITIAL_ADMIN_EMAIL = "admin@example.com";
	process.env.INITIAL_ADMIN_PASSWORD = "secret";
	t.after(() => {
		delete process.env.INITIAL_ADMIN_EMAIL;
		delete process.env.INITIAL_ADMIN_PASSWORD;
	});

	const { model: userModel, calls } = createUserModel({ id: 1 });
	const { setup, auth, perms } = createNoopSetup(userModel);

	await setup.setupDefaultUser();

	assert.equal(calls.insertAndFetch.length, 0);
	assert.equal(auth.calls.length, 0);
	assert.equal(perms.calls.length, 0);
});

test("isSetup returns true when a user exists", async () => {
	const { model: userModel } = createUserModel({ id: 5 });
	const { setup } = createNoopSetup(userModel);

	const result = await setup.isSetup();
	assert.equal(result, true);
});
