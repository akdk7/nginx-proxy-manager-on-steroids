import { migrate as logger } from "../logger.js";

const migrateName = "proxy_host_cors";

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
			proxy_host.integer("cors_override").notNull().unsigned().defaultTo(0);
			proxy_host.text("cors");
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
			proxy_host.dropColumn("cors_override");
			proxy_host.dropColumn("cors");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

export { up, down };
