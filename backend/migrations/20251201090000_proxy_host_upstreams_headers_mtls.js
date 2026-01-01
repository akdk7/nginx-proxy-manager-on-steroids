import { migrate as logger } from "../logger.js";

const migrateName = "proxy_host_upstreams_headers_mtls";

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
			proxy_host.integer("upstream_enabled").notNull().unsigned().defaultTo(0);
			proxy_host.string("upstream_policy").notNull().defaultTo("round_robin");
			proxy_host.text("upstream_servers");
			proxy_host.integer("upstream_ssl_certificate_id").notNull().unsigned().defaultTo(0);
			proxy_host.text("security_headers");
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
			proxy_host.dropColumn("upstream_enabled");
			proxy_host.dropColumn("upstream_policy");
			proxy_host.dropColumn("upstream_servers");
			proxy_host.dropColumn("upstream_ssl_certificate_id");
			proxy_host.dropColumn("security_headers");
		})
		.then(() => {
			logger.info(`[${migrateName}] proxy_host Table altered`);
		});
};

export { up, down };
