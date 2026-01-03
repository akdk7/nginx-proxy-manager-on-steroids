import { migrate as logger } from "../logger.js";

const migrateName = "stream_proxy_protocol";

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const up = (knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);

	return knex.schema
		.table("stream", (table) => {
			table.integer("proxy_protocol").notNull().unsigned().defaultTo(0);
			table.integer("proxy_protocol_upstream").notNull().unsigned().defaultTo(0);
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

/**
 * Undo Migrate
 *
 * @param   {Object} knex
 * @returns {Promise}
 */
const down = (knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);

	return knex.schema
		.table("stream", (table) => {
			table.dropColumn("proxy_protocol");
			table.dropColumn("proxy_protocol_upstream");
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

export { up, down };
