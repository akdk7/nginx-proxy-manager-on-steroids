import { migrate as logger } from "../logger.js";

const migrateName = "geo_access_presets";

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
			proxy_host.string("geo_access_preset").nullable();
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
			return knex.schema.table("stream", (stream) => {
				stream.string("geo_access_preset").nullable();
			});
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
		.table("proxy_host", (proxy_host) => {
			proxy_host.dropColumn("geo_access_preset");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
			return knex.schema.table("stream", (stream) => {
				stream.dropColumn("geo_access_preset");
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

export { up, down };
