import { migrate as logger } from "../logger.js";

const migrateName = "stream_incoming_ports";

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
			stream.json("incoming_ports").nullable();
			stream.json("forwarding_ports").nullable();
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
			stream.dropColumn("incoming_ports");
			stream.dropColumn("forwarding_ports");
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

export { up, down };
