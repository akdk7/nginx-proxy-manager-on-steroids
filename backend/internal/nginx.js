import fs from "node:fs";
import net from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import _ from "lodash";
import errs from "../lib/error.js";
import utils from "../lib/utils.js";
import { debug, nginx as logger } from "../logger.js";
import certificateModel from "../models/certificate.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import deadHostModel from "../models/dead_host.js";
import streamModel from "../models/stream.js";
import settingModel from "../models/setting.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rateLimitZoneSize = "10m";
const headerNameRegex = /^[A-Za-z0-9-]+$/;

const sanitizeHeaderValue = (value) => {
	if (!value) {
		return "";
	}
	return `${value}`.replace(/[\r\n]/g, " ").replace(/"/g, '\\"').trim();
};

const sanitizeSecurityHeaders = (headers) => {
	if (!Array.isArray(headers)) {
		return [];
	}
	const result = [];
	const seen = new Map();

	headers.forEach((header) => {
		const name = `${header?.name || ""}`.trim();
		const value = sanitizeHeaderValue(header?.value || "");
		if (!name || !value || !headerNameRegex.test(name)) {
			return;
		}
		const key = name.toLowerCase();
		if (seen.has(key)) {
			result[seen.get(key)].value = value;
			return;
		}
		seen.set(key, result.length);
		result.push({ name, value });
	});

	return result;
};

const mergeSecurityHeaders = (base, overrides) => {
	const merged = sanitizeSecurityHeaders(base);
	const overrideHeaders = sanitizeSecurityHeaders(overrides);
	overrideHeaders.forEach((header) => {
		const key = header.name.toLowerCase();
		const idx = merged.findIndex((existing) => existing.name.toLowerCase() === key);
		if (idx >= 0) {
			merged[idx] = header;
		} else {
			merged.push(header);
		}
	});
	return merged;
};

const hasHeader = (headers, name) =>
	Array.isArray(headers) && headers.some((header) => header?.name?.toLowerCase() === name.toLowerCase());

const isIpAddress = (host) => {
	if (!host) {
		return false;
	}
	const normalized = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	return net.isIP(normalized) !== 0;
};

const sanitizeUpstreamServers = (servers) => {
	if (!Array.isArray(servers)) {
		return [];
	}
	return servers
		.map((server) => {
			const host = `${server?.host || ""}`.trim();
			const port = Number.parseInt(`${server?.port || ""}`, 10);
			if (!host || !Number.isFinite(port) || port <= 0) {
				return null;
			}
			const weight = Number.parseInt(`${server?.weight || ""}`, 10);
			const maxFails = Number.parseInt(`${server?.max_fails ?? server?.maxFails ?? ""}`, 10);
			const failTimeout = Number.parseInt(`${server?.fail_timeout ?? server?.failTimeout ?? ""}`, 10);
			return {
				host,
				port,
				weight: Number.isFinite(weight) && weight > 0 ? weight : null,
				max_fails: Number.isFinite(maxFails) && maxFails >= 0 ? maxFails : null,
				fail_timeout: Number.isFinite(failTimeout) && failTimeout >= 0 ? failTimeout : null,
				backup: server?.backup === true,
			};
		})
		.filter(Boolean);
};

const internalNginx = {
	/**
	 * This will:
	 * - test the nginx config first to make sure it's OK
	 * - create / recreate the config for the host
	 * - test again
	 * - IF OK:  update the meta with online status
	 * - IF BAD: update the meta with offline status and restore the previous config
	 * - then reload nginx
	 *
	 * @param   {Object|String}  model
	 * @param   {String}         host_type
	 * @param   {Object}         host
	 * @returns {Promise}
	 */
	configure: async (model, host_type, host) => {
		let combined_meta = {};
		const nice_host_type = internalNginx.getFileFriendlyHostType(host_type);
		const config_file = internalNginx.getConfigName(nice_host_type, host.id);
		const err_file = `${config_file}.err`;
		const backup_file = `${config_file}.bak`;
		const has_backup = fs.existsSync(config_file);

		await internalNginx.test();

		if (has_backup) {
			fs.copyFileSync(config_file, backup_file);
		}

		const restoreConfig = (saveFailedConfig) => {
			if (saveFailedConfig && fs.existsSync(config_file)) {
				fs.renameSync(config_file, err_file);
			} else if (!saveFailedConfig && !has_backup) {
				internalNginx.deleteFile(config_file);
			}
			if (has_backup && fs.existsSync(backup_file)) {
				fs.renameSync(backup_file, config_file);
			} else {
				internalNginx.deleteFile(backup_file);
			}
		};

		try {
			await internalNginx.generateConfig(host_type, host);
			await internalNginx.updateRateLimitConfig(host_type);
		} catch (err) {
			restoreConfig(false);
			throw err;
		}

		try {
			await internalNginx.test();
			combined_meta = _.assign({}, host.meta, {
				nginx_online: true,
				nginx_err: null,
			});

			await model.query().where("id", host.id).patch({
				meta: combined_meta,
			});

			internalNginx.deleteFile(backup_file);
			internalNginx.deleteFile(err_file);
			await internalNginx.reload();
			return combined_meta;
		} catch (err) {
			// Remove the error_log line because it's a docker-ism false positive that doesn't need to be reported.
			// It will always look like this:
			//   nginx: [alert] could not open error log file: open() "/var/log/nginx/error.log" failed (6: No such device or address)
			const valid_lines = [];
			const err_lines = `${err?.message || err}`.split("\n");
			err_lines.map((line) => {
				if (line.indexOf("/var/log/nginx/error.log") === -1) {
					valid_lines.push(line);
				}
				return true;
			});

			debug(logger, "Nginx test failed:", valid_lines.join("\n"));

			combined_meta = _.assign({}, host.meta, {
				nginx_online: false,
				nginx_err: valid_lines.join("\n"),
			});

			await model.query().where("id", host.id).patch({
				meta: combined_meta,
			});

			restoreConfig(true);
			return combined_meta;
		}
	},

	/**
	 * @returns {Promise}
	 */
	test: () => {
		debug(logger, "Testing Nginx configuration");
		return utils.execFile("/usr/sbin/nginx", ["-t", "-g", "error_log off;"]);
	},

	/**
	 * @returns {Promise}
	 */
	reload: () => {
		return internalNginx.test().then(() => {
			logger.info("Reloading Nginx");
			return utils.execFile("/usr/sbin/nginx", ["-s", "reload"]);
		});
	},

	isNginxRunning: () => {
		const pidFile = "/run/nginx/nginx.pid";
		if (!fs.existsSync(pidFile)) {
			return false;
		}
		const pid = Number.parseInt(fs.readFileSync(pidFile, { encoding: "utf8" }).trim(), 10);
		if (!Number.isFinite(pid) || pid <= 0) {
			return false;
		}
		return fs.existsSync(`/proc/${pid}`);
	},

	reloadIfRunning: () => {
		if (!internalNginx.isNginxRunning()) {
			logger.info("Skipping nginx reload because it is not running yet");
			return Promise.resolve(true);
		}
		return internalNginx.reload();
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Integer} host_id
	 * @returns {String}
	 */
	getConfigName: (host_type, host_id) => {
		if (host_type === "default") {
			return "/data/nginx/default_host/site.conf";
		}
		return `/data/nginx/${internalNginx.getFileFriendlyHostType(host_type)}/${host_id}.conf`;
	},

	getRateLimitZoneName: (host_id, location_id) => {
		if (typeof location_id !== "undefined" && location_id !== null) {
			return `proxy_host_${host_id}_loc_${location_id}_rate_limit`;
		}
		return `proxy_host_${host_id}_rate_limit`;
	},

	getUpstreamName: (host_type, host_id) =>
		`${internalNginx.getFileFriendlyHostType(host_type)}_${host_id}_upstream`,

	loadUpstreamSslCertificate: async (host) => {
		if (!host?.upstream_ssl_certificate_id || host.upstream_ssl_certificate_id <= 0) {
			return null;
		}
		try {
			const cert = await certificateModel
				.query()
				.where("is_deleted", 0)
				.andWhere("id", host.upstream_ssl_certificate_id)
				.first();
			if (cert) {
				host.upstream_ssl_certificate = cert;
			}
			return cert;
		} catch (err) {
			debug(logger, "Failed to load upstream SSL certificate:", err.message);
			return null;
		}
	},

	updateRateLimitConfig: (host_type) => {
		if (internalNginx.getFileFriendlyHostType(host_type) !== "proxy_host") {
			return Promise.resolve(true);
		}
		return internalNginx.generateRateLimitConfig();
	},

	/**
	 * Generates custom locations
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	renderLocations: (host) => {
		return new Promise((resolve, reject) => {
			let template;

			try {
				template = fs.readFileSync(`${__dirname}/../templates/_location.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			const renderEngine = utils.getRenderEngine();
			let renderedLocations = "";

			const locationRendering = async () => {
				for (let i = 0; i < host.locations.length; i++) {
					const locationCopy = Object.assign(
						{},
						{ access_list_id: host.access_list_id },
						{ certificate_id: host.certificate_id },
						{ upstream_ssl_certificate_id: host.upstream_ssl_certificate_id },
						{ upstream_ssl_certificate: host.upstream_ssl_certificate },
						{ ssl_forced: host.ssl_forced },
						{ caching_enabled: host.caching_enabled },
						{ block_exploits: host.block_exploits },
						{ allow_websocket_upgrade: host.allow_websocket_upgrade },
						{ http2_support: host.http2_support },
						{ hsts_enabled: host.hsts_enabled },
						{ hsts_subdomains: host.hsts_subdomains },
						{ access_list: host.access_list },
						{ certificate: host.certificate },
						host.locations[i],
					);
					locationCopy.security_headers = mergeSecurityHeaders(
						host.security_headers,
						host.locations[i]?.security_headers,
					);
					locationCopy.hsts_header_set = hasHeader(locationCopy.security_headers, "Strict-Transport-Security");
					const locationRateLimitKeys = [
						"rate_limit_enabled",
						"rate_limit_rps",
						"rate_limit_burst",
						"rate_limit_nodelay",
					];
					const locationOverridesRateLimit = locationRateLimitKeys.some(
						(key) => typeof host.locations[i][key] !== "undefined",
					);
					const locationId = host.locations[i]?.id ?? i;
					if (locationOverridesRateLimit) {
						locationCopy.rate_limit_zone_name = internalNginx.getRateLimitZoneName(host.id, locationId);
					} else {
						locationCopy.rate_limit_zone_name = host.rate_limit_zone_name;
					}

					if (locationCopy.forward_host.indexOf("/") > -1) {
						const splitted = locationCopy.forward_host.split("/");

						locationCopy.forward_host = splitted.shift();
						locationCopy.forward_path = `/${splitted.join("/")}`;
					}

					renderedLocations += await renderEngine.parseAndRender(template, locationCopy);
				}
			};

			locationRendering().then(() => resolve(renderedLocations));
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	generateConfig: (host_type, host_row) => {
		// Prevent modifying the original object:
		const host = JSON.parse(JSON.stringify(host_row));
		const nice_host_type = internalNginx.getFileFriendlyHostType(host_type);

		debug(logger, `Generating ${nice_host_type} Config:`, JSON.stringify(host, null, 2));

		const renderEngine = utils.getRenderEngine();

		return new Promise((resolve, reject) => {
			let template = null;
			const filename = internalNginx.getConfigName(nice_host_type, host.id);

			try {
				template = fs.readFileSync(`${__dirname}/../templates/${nice_host_type}.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			let locationsPromise;
			let origLocations;
			const upstreamCertPromise = internalNginx.loadUpstreamSslCertificate(host);

			// Manipulate the data a bit before sending it to the template
			if (nice_host_type !== "default") {
				host.use_default_location = true;
				if (typeof host.advanced_config !== "undefined" && host.advanced_config) {
					host.use_default_location = !internalNginx.advancedConfigHasDefaultLocation(host.advanced_config);
				}
			}

			host.security_headers = sanitizeSecurityHeaders(host.security_headers);
			host.hsts_header_set = hasHeader(host.security_headers, "Strict-Transport-Security");
			const upstreamEnabled = host.upstream_enabled === 1 || host.upstream_enabled === true;
			const upstreamServers = sanitizeUpstreamServers(host.upstream_servers);
			const hasExplicitUpstream = upstreamEnabled && upstreamServers.length > 0;
			const needsStreamUpstream =
				nice_host_type === "stream" &&
				!hasExplicitUpstream &&
				typeof host.forwarding_host === "string" &&
				host.forwarding_host.trim() &&
				!isIpAddress(host.forwarding_host.trim());
			const fallbackStreamServers = needsStreamUpstream
				? sanitizeUpstreamServers([
						{
							host: host.forwarding_host.trim(),
							port: host.forwarding_port,
						},
					])
				: [];

			if (hasExplicitUpstream || fallbackStreamServers.length > 0) {
				host.upstream_enabled = true;
				host.upstream_servers = hasExplicitUpstream ? upstreamServers : fallbackStreamServers;
				host.upstream_name = internalNginx.getUpstreamName(nice_host_type, host.id);
			} else {
				host.upstream_enabled = false;
				host.upstream_servers = [];
				host.upstream_name = null;
			}
			if (!["round_robin", "least_conn", "ip_hash"].includes(host.upstream_policy)) {
				host.upstream_policy = "round_robin";
			}

			if (host.locations) {
				//logger.info ('host.locations = ' + JSON.stringify(host.locations, null, 2));
				origLocations = [].concat(host.locations);
				locationsPromise = upstreamCertPromise.then(() =>
					internalNginx.renderLocations(host).then((renderedLocations) => {
						host.locations = renderedLocations;
					}),
				);

				// Allow someone who is using / custom location path to use it, and skip the default / location
				_.map(host.locations, (location) => {
					if (location.path === "/") {
						host.use_default_location = false;
					}
				});
			} else {
				locationsPromise = upstreamCertPromise;
			}

			// Set the IPv6 setting for the host
			host.ipv6 = internalNginx.ipv6Enabled();
			const hostRateLimitEnabled = host.rate_limit_enabled === 1 || host.rate_limit_enabled === true;
			const hostRateLimitRps = Number.parseInt(host.rate_limit_rps, 10);
			if (hostRateLimitEnabled && Number.isFinite(hostRateLimitRps) && hostRateLimitRps > 0) {
				host.rate_limit_zone_name = internalNginx.getRateLimitZoneName(host.id);
			}

			locationsPromise.then(() => {
				renderEngine
					.parseAndRender(template, host)
					.then((config_text) => {
						fs.writeFileSync(filename, config_text, { encoding: "utf8" });
						debug(logger, "Wrote config:", filename, config_text);

						// Restore locations array
						host.locations = origLocations;

						resolve(true);
					})
					.catch((err) => {
						debug(logger, `Could not write ${filename}:`, err.message);
						reject(new errs.ConfigurationError(err.message));
					});
			});
		});
	},

	generateRateLimitConfig: async () => {
		const renderEngine = utils.getRenderEngine();
		let template = null;
		const filename = "/etc/nginx/conf.d/include/rate_limit.conf";

		try {
			template = fs.readFileSync(`${__dirname}/../templates/rate_limit.conf`, { encoding: "utf8" });
		} catch (err) {
			throw new errs.ConfigurationError(err.message);
		}

		const hosts = await proxyHostModel.query().where("is_deleted", 0);
		const zones = [];
		const zoneNames = new Set();

		const addZone = (name, rate) => {
			if (!name || !rate || zoneNames.has(name)) {
				return;
			}
			zoneNames.add(name);
			zones.push({
				name: name,
				shm_size: rateLimitZoneSize,
				rate: rate,
			});
		};

		hosts.forEach((host) => {
			const hostRateLimitEnabled = host.rate_limit_enabled === 1 || host.rate_limit_enabled === true;
			const hostRateLimitRps = Number.parseInt(host.rate_limit_rps, 10);
			if (hostRateLimitEnabled && Number.isFinite(hostRateLimitRps) && hostRateLimitRps > 0) {
				addZone(internalNginx.getRateLimitZoneName(host.id), hostRateLimitRps);
			}

			if (!Array.isArray(host.locations)) {
				return;
			}

			host.locations.forEach((location, idx) => {
				const locationRateLimitKeys = [
					"rate_limit_enabled",
					"rate_limit_rps",
					"rate_limit_burst",
					"rate_limit_nodelay",
				];
				const locationOverridesRateLimit = locationRateLimitKeys.some(
					(key) => typeof location[key] !== "undefined",
				);
				if (!locationOverridesRateLimit) {
					return;
				}

				const locationRateLimitEnabled =
					location.rate_limit_enabled === 1 || location.rate_limit_enabled === true;
				const locationRateLimitRps = Number.parseInt(location.rate_limit_rps, 10);
				if (
					locationRateLimitEnabled &&
					Number.isFinite(locationRateLimitRps) &&
					locationRateLimitRps > 0
				) {
					const locationId = location?.id ?? idx;
					addZone(internalNginx.getRateLimitZoneName(host.id, locationId), locationRateLimitRps);
				}
			});
		});

		try {
			const configText = await renderEngine.parseAndRender(template, { zones: zones });
			fs.writeFileSync(filename, configText, { encoding: "utf8" });
		} catch (err) {
			throw new errs.ConfigurationError(err.message);
		}
	},

	/**
	 * This generates a temporary nginx config listening on port 80 for the domain names listed
	 * in the certificate setup. It allows the letsencrypt acme challenge to be requested by letsencrypt
	 * when requesting a certificate without having a hostname set up already.
	 *
	 * @param   {Object}  certificate
	 * @returns {Promise}
	 */
	generateLetsEncryptRequestConfig: (certificate) => {
		debug(logger, "Generating LetsEncrypt Request Config:", certificate);
		const renderEngine = utils.getRenderEngine();

		return new Promise((resolve, reject) => {
			let template = null;
			const filename = `/data/nginx/temp/letsencrypt_${certificate.id}.conf`;

			try {
				template = fs.readFileSync(`${__dirname}/../templates/letsencrypt-request.conf`, { encoding: "utf8" });
			} catch (err) {
				reject(new errs.ConfigurationError(err.message));
				return;
			}

			certificate.ipv6 = internalNginx.ipv6Enabled();

			renderEngine
				.parseAndRender(template, certificate)
				.then((config_text) => {
					fs.writeFileSync(filename, config_text, { encoding: "utf8" });
					debug(logger, "Wrote config:", filename, config_text);
					resolve(true);
				})
				.catch((err) => {
					debug(logger, `Could not write ${filename}:`, err.message);
					reject(new errs.ConfigurationError(err.message));
				});
		});
	},

	/**
	 * A simple wrapper around unlinkSync that writes to the logger
	 *
	 * @param   {String}  filename
	 */
	deleteFile: (filename) => {
		if (!fs.existsSync(filename)) {
			return;
		}
		try {
			debug(logger, `Deleting file: ${filename}`);
			fs.unlinkSync(filename);
		} catch (err) {
			debug(logger, "Could not delete file:", JSON.stringify(err, null, 2));
		}
	},

	resetConfigDir: (directory) => {
		if (!fs.existsSync(directory)) {
			fs.mkdirSync(directory, { recursive: true });
			return;
		}
		const files = fs.readdirSync(directory);
		files.forEach((file) => {
			if (file.endsWith(".conf") || file.endsWith(".err")) {
				internalNginx.deleteFile(`${directory}/${file}`);
			}
		});
	},

	/**
	 *
	 * @param   {String} host_type
	 * @returns String
	 */
	getFileFriendlyHostType: (host_type) => {
		return host_type.replace(/-/g, "_");
	},

	/**
	 * This removes the temporary nginx config file generated by `generateLetsEncryptRequestConfig`
	 *
	 * @param   {Object}  certificate
	 * @returns {Promise}
	 */
	deleteLetsEncryptRequestConfig: (certificate) => {
		const config_file = `/data/nginx/temp/letsencrypt_${certificate.id}.conf`;
		return new Promise((resolve /*, reject*/) => {
			internalNginx.deleteFile(config_file);
			resolve();
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @param   {Boolean} [delete_err_file]
	 * @returns {Promise}
	 */
	deleteConfig: (host_type, host, delete_err_file) => {
		const config_file = internalNginx.getConfigName(
			internalNginx.getFileFriendlyHostType(host_type),
			typeof host === "undefined" ? 0 : host.id,
		);
		const config_file_err = `${config_file}.err`;

		return new Promise((resolve /*, reject*/) => {
			internalNginx.deleteFile(config_file);
			if (delete_err_file) {
				internalNginx.deleteFile(config_file_err);
			}
			resolve();
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @returns {Promise}
	 */
	renameConfigAsError: (host_type, host) => {
		const config_file = internalNginx.getConfigName(
			internalNginx.getFileFriendlyHostType(host_type),
			typeof host === "undefined" ? 0 : host.id,
		);
		const config_file_err = `${config_file}.err`;

		return new Promise((resolve /*, reject*/) => {
			fs.unlink(config_file, () => {
				// ignore result, continue
				fs.rename(config_file, config_file_err, () => {
					// also ignore result, as this is a debugging informative file anyway
					resolve();
				});
			});
		});
	},

	/**
	 * @param   {String}  hostType
	 * @param   {Array}   hosts
	 * @returns {Promise}
	 */
	bulkGenerateConfigs: (hostType, hosts) => {
		const promises = [];
		hosts.map((host) => {
			promises.push(internalNginx.generateConfig(hostType, host));
			return true;
		});

		return Promise.all(promises).then(() => {
			return internalNginx.updateRateLimitConfig(hostType);
		});
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Array}   hosts
	 * @returns {Promise}
	 */
	bulkDeleteConfigs: (host_type, hosts) => {
		const promises = [];
		hosts.map((host) => {
			promises.push(internalNginx.deleteConfig(host_type, host, true));
			return true;
		});

		return Promise.all(promises).then(() => {
			return internalNginx.updateRateLimitConfig(host_type);
		});
	},

	/**
	 * @param   {string}  config
	 * @returns {boolean}
	 */
	advancedConfigHasDefaultLocation: (cfg) => !!cfg.match(/^(?:.*;)?\s*?location\s*?\/\s*?{/im),

	/**
	 * @returns {boolean}
	 */
	ipv6Enabled: () => {
		if (typeof process.env.DISABLE_IPV6 !== "undefined") {
			const disabled = process.env.DISABLE_IPV6.toLowerCase();
			return !(disabled === "on" || disabled === "true" || disabled === "1" || disabled === "yes");
		}

		return true;
	},

	regenerateAllConfigs: async () => {
		logger.info("Regenerating all nginx configs...");
		const backupRoot = `/data/nginx/.backup_${Date.now()}`;
		const configDirs = ["proxy_host", "redirection_host", "dead_host", "stream", "default_host", "default_www"];
		const rateLimitConfig = "/etc/nginx/conf.d/include/rate_limit.conf";
		const rateLimitBackup = `${backupRoot}/rate_limit.conf`;

		const backupConfigs = () => {
			fs.mkdirSync(backupRoot, { recursive: true });
			configDirs.forEach((dir) => {
				const source = `/data/nginx/${dir}`;
				const dest = `${backupRoot}/${dir}`;
				if (fs.existsSync(source)) {
					fs.cpSync(source, dest, { recursive: true });
				}
			});
			if (fs.existsSync(rateLimitConfig)) {
				fs.copyFileSync(rateLimitConfig, rateLimitBackup);
			}
		};

		const restoreConfigs = () => {
			configDirs.forEach((dir) => {
				const source = `${backupRoot}/${dir}`;
				const dest = `/data/nginx/${dir}`;
				if (fs.existsSync(source)) {
					fs.rmSync(dest, { recursive: true, force: true });
					fs.renameSync(source, dest);
				} else if (!fs.existsSync(dest)) {
					fs.mkdirSync(dest, { recursive: true });
				}
			});
			if (fs.existsSync(rateLimitBackup)) {
				fs.copyFileSync(rateLimitBackup, rateLimitConfig);
			}
		};

		const cleanupBackup = () => {
			if (fs.existsSync(backupRoot)) {
				fs.rmSync(backupRoot, { recursive: true, force: true });
			}
		};

		let backupReady = false;
		try {
			backupConfigs();
			backupReady = true;

			internalNginx.resetConfigDir("/data/nginx/proxy_host");
			internalNginx.resetConfigDir("/data/nginx/redirection_host");
			internalNginx.resetConfigDir("/data/nginx/dead_host");
			internalNginx.resetConfigDir("/data/nginx/stream");
			internalNginx.resetConfigDir("/data/nginx/default_host");

			const [proxyHosts, redirectionHosts, deadHosts, streams, defaultSite] = await Promise.all([
				proxyHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("enabled", 1)
					.allowGraph("[access_list.[clients,items],certificate]")
					.withGraphFetched("[access_list.[clients,items],certificate]"),
				redirectionHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("enabled", 1)
					.allowGraph("[certificate]")
					.withGraphFetched("[certificate]"),
				deadHostModel
					.query()
					.where("is_deleted", 0)
					.andWhere("enabled", 1)
					.allowGraph("[certificate]")
					.withGraphFetched("[certificate]"),
				streamModel
					.query()
					.where("is_deleted", 0)
					.andWhere("enabled", 1)
					.allowGraph("[certificate]")
					.withGraphFetched("[certificate]"),
				settingModel.query().where("id", "default-site").first(),
			]);

			if (defaultSite) {
				if (defaultSite.value === "html" && typeof defaultSite.meta?.html === "string") {
					fs.mkdirSync("/data/nginx/default_www", { recursive: true });
					fs.writeFileSync("/data/nginx/default_www/index.html", defaultSite.meta.html, { encoding: "utf8" });
				}
				await internalNginx.generateConfig("default", defaultSite);
			}

			if (proxyHosts.length) {
				await internalNginx.bulkGenerateConfigs("proxy_host", proxyHosts);
			}
			if (redirectionHosts.length) {
				await internalNginx.bulkGenerateConfigs("redirection_host", redirectionHosts);
			}
			if (deadHosts.length) {
				await internalNginx.bulkGenerateConfigs("dead_host", deadHosts);
			}
			if (streams.length) {
				await internalNginx.bulkGenerateConfigs("stream", streams);
			}

			await internalNginx.generateRateLimitConfig();
			await internalNginx.test();
			await internalNginx.reloadIfRunning();
			cleanupBackup();
			logger.info("Regenerate nginx configs completed");
		} catch (err) {
			logger.error("Regenerate nginx configs failed, keeping existing configuration:", err?.message || err);
			if (backupReady) {
				restoreConfigs();
			}
			cleanupBackup();
		}
	},
};

export default internalNginx;
