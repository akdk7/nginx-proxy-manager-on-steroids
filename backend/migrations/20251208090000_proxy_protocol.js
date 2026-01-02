import { migrate as logger } from "../logger.js";

const migrateName = "proxy_protocol";

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const up = (_knex) => {
	logger.info(`[${migrateName}] No-op migration (superseded by proxy_host_listen_ports).`);
	return Promise.resolve(true);
};

/**
 * Undo Migrate
 *
 * @param   {Object}  knex
 * @returns {Promise}
 */
const down = (_knex) => {
	logger.warn(`[${migrateName}] You can't migrate down this one.`);
	return Promise.resolve(true);
};

export { up, down };
