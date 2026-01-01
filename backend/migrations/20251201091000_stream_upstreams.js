import { migrate as logger } from "../logger.js";

const migrateName = "stream_upstreams";

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
		.table("stream", (stream) => {
			stream.integer("upstream_enabled").notNull().unsigned().defaultTo(0);
			stream.string("upstream_policy").notNull().defaultTo("round_robin");
			stream.text("upstream_servers");
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
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
		.table("stream", (stream) => {
			stream.dropColumn("upstream_enabled");
			stream.dropColumn("upstream_policy");
			stream.dropColumn("upstream_servers");
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

export { up, down };
