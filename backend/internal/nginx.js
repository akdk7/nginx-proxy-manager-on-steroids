import fs from "node:fs";
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
import {
	hasHeader,
	isIpAddress,
	mergeSecurityHeaders,
	sanitizeSecurityHeaders,
	sanitizeUpstreamServers,
} from "./nginx-helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rateLimitZoneSize = "10m";
const rateLimitOverrideKeys = [
	"rate_limit_enabled",
	"rate_limit_rps",
	"rate_limit_burst",
	"rate_limit_nodelay",
];
let http3SupportCache;
let http3SupportPromise;
const proxyProtocolPortsCache = { ports: [], loadedAt: 0 };
const defaultListenPorts = ["80", "443"];

const normalizeProxyProtocolPorts = (ports) => {
	if (!Array.isArray(ports)) {
		return [];
	}
	const uniquePorts = new Set();
	ports.forEach((port) => {
		const parsed = Number.parseInt(`${port}`, 10);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
			uniquePorts.add(`${parsed}`);
		}
	});
	return Array.from(uniquePorts).sort((a, b) => Number(a) - Number(b));
};

const normalizeListenPorts = (ports, fallbackPorts = defaultListenPorts) => {
	if (typeof ports === "string") {
		ports = ports.split(",");
	}
	if (!Array.isArray(ports)) {
		return [...fallbackPorts];
	}
	const uniquePorts = new Set();
	ports.forEach((port) => {
		const parsed = Number.parseInt(`${port}`, 10);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
			uniquePorts.add(`${parsed}`);
		}
	});
	const normalized = Array.from(uniquePorts).sort((a, b) => Number(a) - Number(b));
	return normalized.length ? normalized : [...fallbackPorts];
};


const readTemplate = (name) => {
	try {
		return fs.readFileSync(`${__dirname}/../templates/${name}`, { encoding: "utf8" });
	} catch (err) {
		throw new errs.ConfigurationError(err.message);
	}
};

const internalNginx = {
	isHttp3Supported: async () => {
		if (typeof http3SupportCache === "boolean") {
			return http3SupportCache;
		}
		if (http3SupportPromise) {
			return http3SupportPromise;
		}
		http3SupportPromise = utils
			.exec("/usr/sbin/nginx -V 2>&1")
			.then((output) => {
				http3SupportCache = output.includes("http_v3_module");
				return http3SupportCache;
			})
			.catch((err) => {
				debug(logger, "Failed to detect HTTP/3 support:", err.message);
				http3SupportCache = false;
				return false;
			})
			.finally(() => {
				http3SupportPromise = null;
			});
		return http3SupportPromise;
	},
	getProxyProtocolPorts: async () => {
		const now = Date.now();
		if (now - proxyProtocolPortsCache.loadedAt < 1000) {
			return proxyProtocolPortsCache.ports;
		}
		const setting = await settingModel.query().where("id", "proxy-protocol").first();
		const ports = normalizeProxyProtocolPorts(setting?.meta?.ports);
		proxyProtocolPortsCache.ports = ports;
		proxyProtocolPortsCache.loadedAt = now;
		return ports;
	},
	invalidateProxyProtocolPortsCache: () => {
		proxyProtocolPortsCache.ports = [];
		proxyProtocolPortsCache.loadedAt = 0;
	},
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

		try {
			await internalNginx.test();
		} catch (err) {
			logger.warn(
				"Existing nginx config is invalid, attempting to continue:",
				err?.message || err,
			);
		}

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

	readConfigText: (host_type, host_id) => {
		const configFile = internalNginx.getConfigName(host_type, host_id);
		const errorFile = `${configFile}.err`;
		if (fs.existsSync(configFile)) {
			return fs.readFileSync(configFile, { encoding: "utf8" });
		}
		if (fs.existsSync(errorFile)) {
			return fs.readFileSync(errorFile, { encoding: "utf8" });
		}
		throw new errs.ItemNotFoundError(`${host_type}:${host_id}`);
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
	loadSslCertificate: async (host) => {
		if (!host?.certificate_id || host.certificate_id <= 0 || host.certificate) {
			return host?.certificate || null;
		}
		try {
			const cert = await certificateModel
				.query()
				.where("is_deleted", 0)
				.andWhere("id", host.certificate_id)
				.first();
			if (cert) {
				host.certificate = cert;
			}
			return cert;
		} catch (err) {
			debug(logger, "Failed to load SSL certificate:", err.message);
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
	renderLocations: async (host) => {
		const template = readTemplate("_location.conf");
		const renderEngine = utils.getRenderEngine();
		let renderedLocations = "";

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
				{ http3_support: host.http3_support },
				{ hsts_enabled: host.hsts_enabled },
				{ hsts_subdomains: host.hsts_subdomains },
				{ access_list: host.access_list },
				{ certificate: host.certificate },
				host.locations[i],
			);
			locationCopy.security_headers = mergeSecurityHeaders(host.security_headers, host.locations[i]?.security_headers);
			locationCopy.hsts_header_set = hasHeader(locationCopy.security_headers, "Strict-Transport-Security");
			const locationOverridesRateLimit = rateLimitOverrideKeys.some(
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

			try {
				renderedLocations += await renderEngine.parseAndRender(template, locationCopy);
			} catch (err) {
				throw new errs.ConfigurationError(err.message);
			}
		}

		return renderedLocations;
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	generateConfig: async (host_type, host_row) => {
		// Prevent modifying the original object:
		const host = JSON.parse(JSON.stringify(host_row));
		const nice_host_type = internalNginx.getFileFriendlyHostType(host_type);

		debug(logger, `Generating ${nice_host_type} Config:`, JSON.stringify(host, null, 2));

		if (host.http3_support === 1 || host.http3_support === true) {
			const http3Supported = await internalNginx.isHttp3Supported();
			if (!http3Supported) {
				logger.warn(
					`HTTP/3 requested but nginx lacks http_v3_module; disabling for host ${host.id}`,
				);
				host.http3_support = false;
			}
		}
		const certificateId = Number.parseInt(`${host.certificate_id || 0}`, 10);
		const requestedCertificate = certificateId > 0;

		const renderEngine = utils.getRenderEngine();
		const filename = internalNginx.getConfigName(nice_host_type, host.id);
		const template = readTemplate(`${nice_host_type}.conf`);
		const sslCertPromise = internalNginx.loadSslCertificate(host);
		const upstreamCertPromise = internalNginx.loadUpstreamSslCertificate(host);
		let origLocations;

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

		if (Array.isArray(host.locations)) {
			//logger.info ('host.locations = ' + JSON.stringify(host.locations, null, 2));
			origLocations = [].concat(host.locations);
			await Promise.all([sslCertPromise, upstreamCertPromise]);
			host.locations = await internalNginx.renderLocations(host);

			// Allow someone who is using / custom location path to use it, and skip the default / location
			if (origLocations.some((location) => location.path === "/")) {
				host.use_default_location = false;
			}
		} else {
			await Promise.all([sslCertPromise, upstreamCertPromise]);
		}

		const hasCertificate = requestedCertificate && !!host.certificate;
		if (requestedCertificate && !host.certificate) {
			logger.warn(
				`Certificate ${host.certificate_id} not found for host ${host.id}; disabling SSL for this config generation.`,
			);
			host.certificate_id = 0;
			host.certificate = null;
			host.ssl_forced = false;
			host.http2_support = false;
			host.http3_support = false;
			host.hsts_enabled = false;
			host.hsts_subdomains = false;
		}

		const fallbackPorts = hasCertificate ? ["80", "443"] : ["80"];
		host.listen_ports = normalizeListenPorts(host.listen_ports, fallbackPorts);
		host.listen_ports_http = hasCertificate ? host.listen_ports.filter((port) => port === "80") : host.listen_ports;
		host.listen_ports_ssl = hasCertificate ? host.listen_ports.filter((port) => port !== "80") : [];
		host.proxy_protocol_ports = await internalNginx.getProxyProtocolPorts();
		host.proxy_protocol_enabled = host.proxy_protocol_ports.some((port) => host.listen_ports.includes(port));
		const http3Requested = host.http3_support === 1 || host.http3_support === true;
		host.http3_enabled = http3Requested && hasCertificate && host.listen_ports_ssl.includes("443");

		// Set the IPv6 setting for the host
		host.ipv6 = internalNginx.ipv6Enabled();
		const hostRateLimitEnabled = host.rate_limit_enabled === 1 || host.rate_limit_enabled === true;
		const hostRateLimitRps = Number.parseInt(host.rate_limit_rps, 10);
		if (hostRateLimitEnabled && Number.isFinite(hostRateLimitRps) && hostRateLimitRps > 0) {
			host.rate_limit_zone_name = internalNginx.getRateLimitZoneName(host.id);
		}

		try {
			const configText = await renderEngine.parseAndRender(template, host);
			fs.writeFileSync(filename, configText, { encoding: "utf8" });
			debug(logger, "Wrote config:", filename, configText);

			// Restore locations array
			if (origLocations) {
				host.locations = origLocations;
			}

			return true;
		} catch (err) {
			debug(logger, `Could not write ${filename}:`, err.message);
			throw new errs.ConfigurationError(err.message);
		}
	},

	generateRateLimitConfig: async () => {
		const renderEngine = utils.getRenderEngine();
		const filename = "/etc/nginx/conf.d/include/rate_limit.conf";
		const template = readTemplate("rate_limit.conf");

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
				const locationOverridesRateLimit = rateLimitOverrideKeys.some(
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
	generateLetsEncryptRequestConfig: async (certificate) => {
		debug(logger, "Generating LetsEncrypt Request Config:", certificate);
		const renderEngine = utils.getRenderEngine();
		const template = readTemplate("letsencrypt-request.conf");
		const filename = `/data/nginx/temp/letsencrypt_${certificate.id}.conf`;

		certificate.ipv6 = internalNginx.ipv6Enabled();
		certificate.proxy_protocol_ports = await internalNginx.getProxyProtocolPorts();

		try {
			const configText = await renderEngine.parseAndRender(template, certificate);
			fs.writeFileSync(filename, configText, { encoding: "utf8" });
			debug(logger, "Wrote config:", filename, configText);
			return true;
		} catch (err) {
			debug(logger, `Could not write ${filename}:`, err.message);
			throw new errs.ConfigurationError(err.message);
		}
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
