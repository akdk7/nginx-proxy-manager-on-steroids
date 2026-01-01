import { migrate as logger } from "../logger.js";

const migrateName = "redirect_auto_scheme";

/**
 * Migrate
 *
 * @see http://knexjs.org/#Schema
 *
 * @param   {Object} _knex
 * @returns {Promise}
 */
const up = (_knex) => {
	logger.info(`[${migrateName}] Migrating Up...`);
	logger.info(`[${migrateName}] Migrating Up Complete`);
	return Promise.resolve(true);
};

/**
 * Undo Migrate
 *
 * @param   {Object} _knex
 * @returns {Promise}
 */
const down = (_knex) => {
	logger.info(`[${migrateName}] Migrating Down...`);
	logger.info(`[${migrateName}] Migrating Down Complete`);
	return Promise.resolve(true);
};

export { up, down };
