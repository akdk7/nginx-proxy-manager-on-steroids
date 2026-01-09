import fs from "node:fs";
import errs from "../lib/error.js";
import settingModel from "../models/setting.js";
import internalNginx from "./nginx.js";
import { getCorsDefaults } from "../lib/cors-config.js";

const internalSetting = {
	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {String}  data.id
	 * @return {Promise}
	 */
	update: (access, data) => {
		return access
			.can("settings:update", data.id)
			.then((/*access_data*/) => {
				return internalSetting.get(access, { id: data.id });
			})
			.then((row) => {
				if (row.id !== data.id) {
					// Sanity check that something crazy hasn't happened
					throw new errs.InternalValidationError(
						`Setting could not be updated, IDs do not match: ${row.id} !== ${data.id}`,
					);
				}

				return settingModel.query().where({ id: data.id }).patch(data);
			})
			.then(() => {
				return internalSetting.get(access, {
					id: data.id,
				});
			})
			.then((row) => {
				if (row.id === "default-site") {
					// write the html if we need to
					if (row.value === "html") {
						fs.writeFileSync("/data/nginx/default_www/index.html", row.meta.html, { encoding: "utf8" });
					}

					// Configure nginx
					return internalNginx
						.deleteConfig("default")
						.then(() => {
							return internalNginx.generateConfig("default", row);
						})
						.then(() => {
							return internalNginx.test();
						})
						.then(() => {
							return internalNginx.reload();
						})
						.then(() => {
							return row;
						})
						.catch((/*err*/) => {
							internalNginx
								.deleteConfig("default")
								.then(() => {
									return internalNginx.test();
								})
								.then(() => {
									return internalNginx.reload();
								})
								.then(() => {
									// I'm being slack here I know..
								throw new errs.ValidationError("Could not reconfigure Nginx. Please check logs.");
							});
						});
				}
				if (row.id === "proxy-protocol") {
					internalNginx.invalidateProxyProtocolPortsCache();
					return internalNginx.regenerateAllConfigs().then(() => row);
				}
				if (row.id === "geo-access") {
					return internalNginx
						.regenerateAllConfigs()
						.then(() => internalNginx.refreshGeoAccessStatus())
						.then((status) => {
							row.meta = row.meta || {};
							row.meta.status = status;
							return row;
						});
				}
				if (row.id === "block-exploits") {
					return internalNginx
						.generateBlockExploitsConfig()
						.then(() => internalNginx.reloadIfRunning())
						.then(() => row);
				}
				return row;
			});
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   data
	 * @param  {String}   data.id
	 * @return {Promise}
	 */
	get: (access, data) => {
		return access
			.can("settings:get", data.id)
			.then(() => {
				if (data.id === "cors-defaults") {
					return {
						id: "cors-defaults",
						name: "CORS Defaults",
						description: "Resolved CORS defaults from environment",
						value: "cors-defaults",
						meta: getCorsDefaults(),
					};
				}
				return settingModel.query().where("id", data.id).first();
			})
			.then((row) => {
				if (row) {
					if (row.id === "cors-defaults") {
						return row;
					}
					if (row.id === "geo-access") {
						return internalNginx.getGeoAccessStatus().then((status) => {
							row.meta = row.meta || {};
							row.meta.status = status;
							return row;
						});
					}
					if (row.id === "block-exploits") {
						row.meta = row.meta || {};
						if (!Array.isArray(row.meta.disabled)) {
							row.meta.disabled = [];
						}
						if (!Array.isArray(row.meta.custom)) {
							row.meta.custom = [];
						}
						row.meta.defaults = internalNginx.getBlockExploitsDefaults();
						return row;
					}
					return row;
				}
				throw new errs.ItemNotFoundError(data.id);
			});
	},

	/**
	 * This will only count the settings
	 *
	 * @param   {Access}  access
	 * @returns {*}
	 */
	getCount: (access) => {
		return access
			.can("settings:list")
			.then(() => {
				return settingModel.query().count("id as count").first();
			})
			.then((row) => {
				return Number.parseInt(row.count, 10);
			});
	},

	/**
	 * All settings
	 *
	 * @param   {Access}  access
	 * @returns {Promise}
	 */
	getAll: (access) => {
		return access.can("settings:list").then(() => {
			return settingModel.query().orderBy("description", "ASC");
		});
	},
};

export default internalSetting;
