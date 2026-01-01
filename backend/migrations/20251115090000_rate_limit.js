import { migrate as logger } from "../logger.js";

const migrateName = "rate_limit";

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.table("proxy_host", (proxy_host) => {
			proxy_host.integer("rate_limit_enabled").notNull().unsigned().defaultTo(0);
			proxy_host.integer("rate_limit_rps").notNull().unsigned().defaultTo(0);
			proxy_host.integer("rate_limit_burst").notNull().unsigned().defaultTo(0);
			proxy_host.integer("rate_limit_nodelay").notNull().unsigned().defaultTo(0);
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.table("proxy_host", (proxy_host) => {
			proxy_host.dropColumn("rate_limit_enabled");
			proxy_host.dropColumn("rate_limit_rps");
			proxy_host.dropColumn("rate_limit_burst");
			proxy_host.dropColumn("rate_limit_nodelay");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

export { up, down };
