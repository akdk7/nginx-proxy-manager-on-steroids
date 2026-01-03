import { migrate as logger } from "../logger.js";

const migrateName = "geo_access";

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
			proxy_host.integer("geo_access_override").notNull().unsigned().defaultTo(0);
			proxy_host.integer("geo_access_enabled").notNull().unsigned().defaultTo(0);
			proxy_host.string("geo_access_mode").notNull().defaultTo("allow");
			proxy_host.text("geo_access_countries");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
			return knex.schema.table("stream", (stream) => {
				stream.integer("geo_access_override").notNull().unsigned().defaultTo(0);
				stream.integer("geo_access_enabled").notNull().unsigned().defaultTo(0);
				stream.string("geo_access_mode").notNull().defaultTo("allow");
				stream.text("geo_access_countries");
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
			proxy_host.dropColumn("geo_access_override");
			proxy_host.dropColumn("geo_access_enabled");
			proxy_host.dropColumn("geo_access_mode");
			proxy_host.dropColumn("geo_access_countries");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
			return knex.schema.table("stream", (stream) => {
				stream.dropColumn("geo_access_override");
				stream.dropColumn("geo_access_enabled");
				stream.dropColumn("geo_access_mode");
				stream.dropColumn("geo_access_countries");
			});
		})
		.then(() => {
			logger.info(`[${migrateName}] stream Table altered`);
		});
};

export { up, down };
