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
	sanitizeGeoCountries,
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
const geoAccessModes = ["allow", "deny"];
const defaultGeoDbPath = "/data/GeoLite2-Country.mmdb";
let http3SupportCache;
let http3SupportPromise;
let geoAccessStatusCache = null;
let geoAccessStatusPromise;
const proxyProtocolPortsCache = { ports: [], loadedAt: 0 };
const defaultListenPorts = ["80", "443"];
const geoipModuleConfigPath = "/etc/nginx/modules/50-geoip2.conf";
const geoipHttpModulePath = "/usr/lib/nginx/modules/ngx_http_geoip2_module.so";
const geoipStreamModulePath = "/usr/lib/nginx/modules/ngx_stream_geoip2_module.so";
const blockExploitsDefaultPath = "/etc/nginx/conf.d/include/block-exploits.default.conf";
const blockExploitsGeneratedPath = "/data/nginx/block-exploits.conf";
const geoipMetadataMarker = Buffer.from([
	0xab, 0xcd, 0xef, 0x4d, 0x61, 0x78, 0x4d, 0x69, 0x6e, 0x64, 0x2e, 0x63, 0x6f, 0x6d,
]);

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
	const rawPorts = typeof ports === "string" ? ports.split(",") : ports;
	if (!Array.isArray(rawPorts)) {
		return [...fallbackPorts];
	}
	const uniquePorts = new Set();
	rawPorts.forEach((port) => {
		const parsed = Number.parseInt(`${port}`, 10);
		if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 65535) {
			uniquePorts.add(`${parsed}`);
		}
	});
	const normalized = Array.from(uniquePorts).sort((a, b) => Number(a) - Number(b));
	return normalized.length ? normalized : [...fallbackPorts];
};

const collectStreamPortList = (ports) => {
	const rawPorts =
		typeof ports === "string" ? ports.split(",") : Array.isArray(ports) ? ports : [];
	const normalized = [];
	const seen = new Set();
	let hasInvalid = false;
	let hasDuplicates = false;
	rawPorts.forEach((port) => {
		const parsed = Number.parseInt(`${port}`, 10);
		if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
			hasInvalid = true;
			return;
		}
		if (seen.has(parsed)) {
			hasDuplicates = true;
			return;
		}
		seen.add(parsed);
		normalized.push(`${parsed}`);
	});
	return { ports: normalized, hasInvalid, hasDuplicates };
};

const normalizeStreamPorts = (ports, incomingPort) => {
	const result = collectStreamPortList(ports);
	if (result.ports.length) {
		return result.ports;
	}
	const fallback = Number.parseInt(`${incomingPort}`, 10);
	if (Number.isFinite(fallback) && fallback >= 1 && fallback <= 65535) {
		return [`${fallback}`];
	}
	return [];
};

const collectStreamPortNumbers = (ports, fallbackPort) => {
	const result = collectStreamPortList(ports);
	let normalized = result.ports.map((port) => Number.parseInt(port, 10)).filter(Number.isFinite);
	if (!normalized.length) {
		const fallback = Number.parseInt(`${fallbackPort}`, 10);
		if (Number.isFinite(fallback) && fallback >= 1 && fallback <= 65535) {
			normalized = [fallback];
		}
	}
	return { ports: normalized, hasInvalid: result.hasInvalid, hasDuplicates: result.hasDuplicates };
};

const getStreamPortMapVariable = (id) => `stream_target_${id}`;

const buildStreamPortMap = (host) => {
	if (!host?.id) {
		return null;
	}
	const incoming = collectStreamPortNumbers(host.incoming_ports, host.incoming_port);
	const forwarding = collectStreamPortNumbers(host.forwarding_ports, host.forwarding_port);
	if (incoming.hasInvalid || forwarding.hasInvalid || incoming.hasDuplicates || forwarding.hasDuplicates) {
		return null;
	}
	if (!incoming.ports.length || !forwarding.ports.length) {
		return null;
	}
	if (incoming.ports.length !== forwarding.ports.length || incoming.ports.length <= 1) {
		return null;
	}
	const entries = [];
	for (let i = 0; i < incoming.ports.length; i += 1) {
		const target = formatStreamTarget(host.forwarding_host, forwarding.ports[i]);
		if (!target) {
			return null;
		}
		entries.push({ incoming_port: incoming.ports[i], target });
	}
	if (!entries.length) {
		return null;
	}
	return {
		variable: getStreamPortMapVariable(host.id),
		default_target: entries[0].target,
		entries,
	};
};

const normalizeGeoAccessMode = (mode) => (geoAccessModes.includes(mode) ? mode : "allow");

const normalizeGeoDbPath = (path) => {
	const normalized = `${path || ""}`.trim();
	return normalized || defaultGeoDbPath;
};

const sanitizeGeoPresetId = (value) => `${value || ""}`.trim();

const sanitizeGeoPresetName = (value) => `${value || ""}`.trim();

const readGeoipModuleConfig = () => {
	if (!fs.existsSync(geoipModuleConfigPath)) {
		return { present: false, content: null };
	}
	try {
		return { present: true, content: fs.readFileSync(geoipModuleConfigPath, { encoding: "utf8" }) };
	} catch (_err) {
		return { present: true, content: null };
	}
};

const validateGeoDb = (path) => {
	const normalized = normalizeGeoDbPath(path);
	const status = {
		path: normalized,
		exists: false,
		readable: false,
		valid: false,
		size: 0,
	};

	if (!normalized) {
		return status;
	}

	let stat;
	try {
		stat = fs.statSync(normalized);
	} catch (_err) {
		return status;
	}

	if (!stat.isFile()) {
		status.exists = true;
		return status;
	}

	status.exists = true;
	status.size = stat.size;

	try {
		fs.accessSync(normalized, fs.constants.R_OK);
		status.readable = true;
	} catch (_err) {
		return status;
	}

	if (stat.size <= 0) {
		return status;
	}

	let fd;
	try {
		fd = fs.openSync(normalized, "r");
		const tailSize = Math.min(512, stat.size);
		const buffer = Buffer.alloc(tailSize);
		fs.readSync(fd, buffer, 0, tailSize, stat.size - tailSize);
		status.valid = buffer.indexOf(geoipMetadataMarker) >= 0;
	} catch (_err) {
		return status;
	} finally {
		if (typeof fd === "number") {
			try {
				fs.closeSync(fd);
			} catch (_err) {
				// ignore close errors
			}
		}
	}

	return status;
};

const sanitizeGeoPresets = (presets) => {
	if (!Array.isArray(presets)) {
		return [];
	}
	const seen = new Set();
	const result = [];
	presets.forEach((preset) => {
		const id = sanitizeGeoPresetId(preset?.id);
		const name = sanitizeGeoPresetName(preset?.name);
		if (!id || !name || seen.has(id)) {
			return;
		}
		seen.add(id);
		result.push({
			id,
			name,
			mode: normalizeGeoAccessMode(preset?.mode),
			countries: sanitizeGeoCountries(preset?.countries),
		});
	});
	return result;
};

const slugifySection = (value) => {
	return (
		`${value || ""}`
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/(^-|-$)/g, "") || "custom"
	);
};

const exploitOperators = ["~", "~*", "!~", "!~*", "=", "!="];

const normalizeExploitPattern = (pattern) => `${pattern || ""}`.replace(/\r?\n/g, " ").trim();

const normalizeExploitVariable = (value) => {
	const normalized = `${value || ""}`.trim().replace(/^\$/, "");
	if (!normalized || !/^[a-zA-Z0-9_]+$/.test(normalized)) {
		return "";
	}
	return normalized;
};

const normalizeExploitOperator = (value) => {
	const normalized = `${value || ""}`.trim();
	return exploitOperators.includes(normalized) ? normalized : "~";
};

const normalizeExploitEntry = (entry) => {
	const variable = normalizeExploitVariable(entry?.variable ?? entry?.target);
	const operator = normalizeExploitOperator(entry?.operator);
	const normalized = {
		section: slugifySection(entry?.section),
		variable,
		operator,
		pattern: normalizeExploitPattern(entry?.pattern),
	};
	if (!normalized.pattern || !normalized.variable) {
		return null;
	}
	return normalized;
};

const exploitEntryKey = (entry) => {
	const normalized = normalizeExploitEntry(entry);
	if (!normalized) {
		return "";
	}
	return `${normalized.section}::${normalized.variable}::${normalized.operator}::${normalized.pattern}`;
};

const parseBlockExploitsConfig = (configText) => {
	const sections = [];
	let current = null;

	const lines = `${configText || ""}`.split(/\r?\n/);
	lines.forEach((line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		const headingMatch = /^##\s+(.*)$/.exec(trimmed);
		if (headingMatch) {
			const title = headingMatch[1].trim();
			const id = slugifySection(title);
			current = {
				id,
				title,
				variable: null,
				entries: [],
			};
			sections.push(current);
			return;
		}
		if (!current) {
			return;
		}
		const setMatch = /^set\s+\$(\w+)\s+0;/.exec(trimmed);
		if (setMatch && !current.variable) {
			current.variable = setMatch[1];
			return;
		}
		const ruleMatch =
			/if\s+\(\$(\w+)\s+(=|!=|~\*|~|!~\*|!~)\s+"([^"]+)"\)/.exec(trimmed);
		if (ruleMatch) {
			current.entries.push({
				section: current.id,
				variable: ruleMatch[1],
				operator: ruleMatch[2],
				pattern: ruleMatch[3],
			});
		}
	});

	return sections;
};

const getSectionVariable = (section) => {
	if (section.variable) {
		return section.variable;
	}
	const safe = slugifySection(section.id).replace(/-/g, "_");
	return `block_${safe || "custom"}`;
};

const mergeExploitSections = (defaultSections, disabledEntries, customEntries) => {
	const disabledKeys = new Set();
	(disabledEntries || []).forEach((entry) => {
		const key = exploitEntryKey(entry);
		if (key) {
			disabledKeys.add(key);
		}
	});

	const mergedSections = (defaultSections || []).map((section) => ({
		id: section.id,
		title: section.title,
		variable: getSectionVariable(section),
		entries: [],
	}));
	const sectionIndex = new Map();
	mergedSections.forEach((section, index) => sectionIndex.set(section.id, index));

	const existingKeys = new Set();
	(defaultSections || []).forEach((section) => {
		const targetIndex = sectionIndex.get(section.id);
		if (typeof targetIndex !== "number") {
			return;
		}
		const targetSection = mergedSections[targetIndex];
		(section.entries || []).forEach((entry) => {
			const normalized = normalizeExploitEntry(entry);
			if (!normalized) {
				return;
			}
			const key = exploitEntryKey(normalized);
			if (!key || disabledKeys.has(key) || existingKeys.has(key)) {
				return;
			}
			existingKeys.add(key);
			targetSection.entries.push(normalized);
		});
	});

	(customEntries || []).forEach((entry) => {
		const normalized = normalizeExploitEntry(entry);
		if (!normalized) {
			return;
		}
		const key = exploitEntryKey(normalized);
		if (!key || existingKeys.has(key)) {
			return;
		}
		existingKeys.add(key);
		let targetSectionIndex = sectionIndex.get(normalized.section);
		if (typeof targetSectionIndex !== "number") {
			mergedSections.push({
				id: normalized.section,
				title: normalized.section,
				variable: getSectionVariable({ id: normalized.section }),
				entries: [],
			});
			targetSectionIndex = mergedSections.length - 1;
			sectionIndex.set(normalized.section, targetSectionIndex);
		}
		mergedSections[targetSectionIndex].entries.push(normalized);
	});

	return mergedSections;
};

const renderBlockExploitsConfig = (sections) => {
	const lines = ["# Generated by Nginx Proxy Manager", ""];

	(sections || []).forEach((section) => {
		if (!section.entries || section.entries.length === 0) {
			return;
		}
		const variable = getSectionVariable(section);
		lines.push(`## ${section.title || section.id}`);
		lines.push(`set $${variable} 0;`, "");
		section.entries.forEach((entry) => {
			const variable = normalizeExploitVariable(entry.variable ?? entry.target);
			if (!variable) {
				return;
			}
			const operator = normalizeExploitOperator(entry.operator);
			const pattern = normalizeExploitPattern(entry.pattern).replace(/"/g, '\\"');
			lines.push(`if ($${variable} ${operator} "${pattern}") {`);
			lines.push(`\tset $${variable} 1;`);
			lines.push("}", "");
		});
		lines.push(`if ($${variable} = 1) {`);
		lines.push("\treturn 403;");
		lines.push("}", "");
		lines.push("");
	});

	return `${lines.join("\n").trim()}\n`;
};

const formatStreamTarget = (host, port) => {
	const normalizedHost = `${host || ""}`.trim();
	const parsedPort = Number.parseInt(`${port || ""}`, 10);
	if (!normalizedHost || !Number.isFinite(parsedPort) || parsedPort <= 0) {
		return null;
	}
	let targetHost = normalizedHost;
	if (isIpAddress(normalizedHost) && normalizedHost.includes(":") && !normalizedHost.startsWith("[")) {
		targetHost = `[${normalizedHost}]`;
	}
	return `${targetHost}:${parsedPort}`;
};

const resolveCertificateFullchainPath = (certificate, certificateId) => {
	if (!certificate || !certificateId) {
		return null;
	}
	if (certificate.provider === "letsencrypt") {
		return `/etc/letsencrypt/live/npm-${certificateId}/fullchain.pem`;
	}
	return `/data/custom_ssl/npm-${certificateId}/fullchain.pem`;
};

const hasOcspUri = async (certificate, certificateId) => {
	const certificatePath = resolveCertificateFullchainPath(certificate, certificateId);
	if (!certificatePath || !fs.existsSync(certificatePath)) {
		return false;
	}
	try {
		const result = await utils.execFile("openssl", ["x509", "-in", certificatePath, "-noout", "-ocsp_uri"]);
		return result.trim().length > 0;
	} catch (err) {
		debug(logger, `Failed to read OCSP URI for cert ${certificateId}:`, err.message);
		return false;
	}
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
	getGeoAccessStatus: async () => {
		if (geoAccessStatusCache) {
			return geoAccessStatusCache;
		}
		return internalNginx.refreshGeoAccessStatus();
	},
	getBlockExploitsDefaults: () => {
		try {
			if (!fs.existsSync(blockExploitsDefaultPath)) {
				return [];
			}
			const raw = fs.readFileSync(blockExploitsDefaultPath, { encoding: "utf8" });
			return parseBlockExploitsConfig(raw);
		} catch (err) {
			debug(logger, "Failed to read default block-exploits config:", err.message);
			return [];
		}
	},
	generateBlockExploitsConfig: async () => {
		const setting = await settingModel.query().where("id", "block-exploits").first();
		const meta = setting?.meta || {};
		const defaults = internalNginx.getBlockExploitsDefaults();
		const disabled = Array.isArray(meta.disabled) ? meta.disabled : [];
		const custom = Array.isArray(meta.custom) ? meta.custom : [];
		const merged = mergeExploitSections(defaults, disabled, custom);
		const configText = renderBlockExploitsConfig(merged);

		fs.mkdirSync("/data/nginx", { recursive: true });
		fs.writeFileSync(blockExploitsGeneratedPath, configText, { encoding: "utf8" });
	},
	refreshGeoAccessStatus: async () => {
		if (geoAccessStatusPromise) {
			return geoAccessStatusPromise;
		}
		geoAccessStatusPromise = (async () => {
			const geoSettings = await internalNginx.getGeoSettings();
			const dbStatus = validateGeoDb(geoSettings?.db_path);
			const moduleConfig = readGeoipModuleConfig();
			const moduleConfigContent = moduleConfig.content || "";
			const httpConfigured = moduleConfigContent.includes(geoipHttpModulePath);
			const streamConfigured = moduleConfigContent.includes(geoipStreamModulePath);
			const status = {
				checked_at: new Date().toISOString(),
				modules: {
					config_path: geoipModuleConfigPath,
					config_present: moduleConfig.present,
					http: {
						path: geoipHttpModulePath,
						present: fs.existsSync(geoipHttpModulePath),
						configured: httpConfigured,
					},
					stream: {
						path: geoipStreamModulePath,
						present: fs.existsSync(geoipStreamModulePath),
						configured: streamConfigured,
					},
				},
				database: dbStatus,
			};
			geoAccessStatusCache = status;
			return status;
		})()
			.catch((err) => {
				debug(logger, "GeoIP2 status check failed:", err?.message || err);
				const status = {
					checked_at: new Date().toISOString(),
					modules: {
						config_path: geoipModuleConfigPath,
						config_present: false,
						http: { path: geoipHttpModulePath, present: false, configured: false },
						stream: { path: geoipStreamModulePath, present: false, configured: false },
					},
					database: validateGeoDb(defaultGeoDbPath),
				};
				geoAccessStatusCache = status;
				return status;
			})
			.finally(() => {
				geoAccessStatusPromise = null;
			});
		return geoAccessStatusPromise;
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
			await internalNginx.updateGeoConfig();
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
	updateGeoConfig: () => {
		return internalNginx.generateGeoConfig();
	},
	getGeoSettings: async () => {
		const setting = await settingModel.query().where("id", "geo-access").first();
		const meta = setting?.meta || {};
		const httpEnabled = meta.http_enabled ?? meta.httpEnabled;
		const streamEnabled = meta.stream_enabled ?? meta.streamEnabled;
		const dbPath = meta.db_path ?? meta.dbPath;
		return {
			http_enabled: httpEnabled === true || httpEnabled === 1,
			stream_enabled: streamEnabled === true || streamEnabled === 1,
			mode: normalizeGeoAccessMode(meta.mode),
			countries: sanitizeGeoCountries(meta.countries),
			db_path: normalizeGeoDbPath(dbPath),
			presets: sanitizeGeoPresets(meta.presets),
		};
	},
	resolveGeoAccess: (geoSettings, host, hostType) => {
		if (!geoSettings) {
			return { enabled: false, mode: "allow", countries: [] };
		}
		const override = host?.geo_access_override === 1 || host?.geo_access_override === true;
		const enabled = host?.geo_access_enabled === 1 || host?.geo_access_enabled === true;
		const typeEnabled = hostType === "stream" ? geoSettings.stream_enabled : geoSettings.http_enabled;
		const presetId = override ? sanitizeGeoPresetId(host?.geo_access_preset) : "";
		const preset = presetId
			? geoSettings.presets.find((candidate) => candidate.id === presetId)
			: null;
		const mode = preset
			? normalizeGeoAccessMode(preset.mode)
			: override
				? normalizeGeoAccessMode(host?.geo_access_mode)
				: geoSettings.mode;
		const countries = preset
			? sanitizeGeoCountries(preset.countries)
			: override
				? sanitizeGeoCountries(host?.geo_access_countries)
				: geoSettings.countries;
		const isEnabled = override ? enabled : typeEnabled;
		if (!isEnabled || countries.length === 0) {
			return { enabled: false, mode, countries: [] };
		}
		return {
			enabled: true,
			mode,
			countries,
		};
	},
	getStreamGeoAccessVariable: (id) => `stream_geo_target_${id}`,
	getStreamProxyPassTarget: (host) => {
		const upstreamEnabled = host.upstream_enabled === 1 || host.upstream_enabled === true;
		const upstreamServers = sanitizeUpstreamServers(host.upstream_servers);
		const hasExplicitUpstream = upstreamEnabled && upstreamServers.length > 0;
		const portMap = buildStreamPortMap(host);
		if (portMap && !upstreamEnabled) {
			return `$${portMap.variable}`;
		}
		const needsStreamUpstream =
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
			return internalNginx.getUpstreamName("stream", host.id);
		}
		return formatStreamTarget(host.forwarding_host, host.forwarding_port);
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
		const streamPortMap = nice_host_type === "stream" ? buildStreamPortMap(host) : null;
		const needsStreamUpstream =
			nice_host_type === "stream" &&
			!hasExplicitUpstream &&
			!streamPortMap &&
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
		host.certificate_has_ocsp = hasCertificate
			? await hasOcspUri(host.certificate, host.certificate_id)
			: false;

		const fallbackPorts = hasCertificate ? ["80", "443"] : ["80"];
		host.listen_ports = normalizeListenPorts(host.listen_ports, fallbackPorts);
		host.listen_ports_http = hasCertificate ? host.listen_ports.filter((port) => port === "80") : host.listen_ports;
		host.listen_ports_ssl = hasCertificate ? host.listen_ports.filter((port) => port !== "80") : [];
		host.proxy_protocol_ports = await internalNginx.getProxyProtocolPorts();
		host.proxy_protocol_enabled = host.proxy_protocol_ports.some((port) => host.listen_ports.includes(port));
		const http3Requested = host.http3_support === 1 || host.http3_support === true;

		if (nice_host_type === "stream") {
			host.incoming_ports = normalizeStreamPorts(host.incoming_ports, host.incoming_port);
			host.incoming_port = host.incoming_ports[0] || host.incoming_port;
			host.stream_proxy_pass_target = internalNginx.getStreamProxyPassTarget(host);
		}
		host.http3_enabled = http3Requested && hasCertificate && host.listen_ports_ssl.includes("443");

		// Set the IPv6 setting for the host
		host.ipv6 = internalNginx.ipv6Enabled();
		const hostRateLimitEnabled = host.rate_limit_enabled === 1 || host.rate_limit_enabled === true;
		const hostRateLimitRps = Number.parseInt(host.rate_limit_rps, 10);
		if (hostRateLimitEnabled && Number.isFinite(hostRateLimitRps) && hostRateLimitRps > 0) {
			host.rate_limit_zone_name = internalNginx.getRateLimitZoneName(host.id);
		}
		if (nice_host_type === "proxy_host" || nice_host_type === "stream") {
			const geoSettings = await internalNginx.getGeoSettings();
			const geoAccess = internalNginx.resolveGeoAccess(geoSettings, host, nice_host_type);
			host.geo_access_enabled = geoAccess.enabled;
			host.geo_access_mode = geoAccess.mode;
			host.geo_access_countries = geoAccess.countries;
			if (nice_host_type === "stream") {
				host.geo_access_variable = internalNginx.getStreamGeoAccessVariable(host.id);
			}
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
	generateGeoConfig: async () => {
		const geoSettings = await internalNginx.getGeoSettings();
		const [proxyHosts, streams] = await Promise.all([
			proxyHostModel.query().where("is_deleted", 0).andWhere("enabled", 1),
			streamModel.query().where("is_deleted", 0).andWhere("enabled", 1),
		]);
		const httpGeoEnabled =
			proxyHosts.length > 0 &&
			(geoSettings.http_enabled && geoSettings.countries.length > 0
				? true
				: proxyHosts.some((host) => internalNginx.resolveGeoAccess(geoSettings, host, "proxy_host").enabled));
		const streamGeoEnabled =
			streams.length > 0 &&
			(geoSettings.stream_enabled && geoSettings.countries.length > 0
				? true
				: streams.some((host) => internalNginx.resolveGeoAccess(geoSettings, host, "stream").enabled));

		await internalNginx.generateGeoip2Config("http", geoSettings, httpGeoEnabled);
		await internalNginx.generateGeoip2Config("stream", geoSettings, streamGeoEnabled);
		await internalNginx.generateStreamGeoConfig(streams, geoSettings, streamGeoEnabled);
	},
	generateGeoip2Config: async (context, geoSettings, enabled) => {
		const renderEngine = utils.getRenderEngine();
		const suffix = context === "stream" ? "stream" : "http";
		const filename = `/etc/nginx/conf.d/include/geoip2_${suffix}.conf`;

		if (!enabled || !geoSettings?.db_path) {
			fs.writeFileSync(filename, "# GeoIP2 disabled\n", { encoding: "utf8" });
			return;
		}

		const template = readTemplate(`geoip2_${suffix}.conf`);
		try {
			const configText = await renderEngine.parseAndRender(template, {
				geoip2_db_path: geoSettings.db_path,
			});
			fs.writeFileSync(filename, configText, { encoding: "utf8" });
		} catch (err) {
			throw new errs.ConfigurationError(err.message);
		}
	},
generateStreamGeoConfig: async (streams, geoSettings, _enabled) => {
		const renderEngine = utils.getRenderEngine();
		const filename = "/etc/nginx/conf.d/include/stream_geo.conf";

		const streamEntries = [];
		const streamPortMaps = [];
		streams.forEach((stream) => {
			const upstreamEnabled = stream.upstream_enabled === 1 || stream.upstream_enabled === true;
			const portMap = buildStreamPortMap(stream);
			if (portMap && !upstreamEnabled) {
				streamPortMaps.push({
					id: stream.id,
					stream_port_map_variable: portMap.variable,
					stream_port_map_default: portMap.default_target,
					stream_port_map: portMap.entries,
				});
			}
			const geoAccess = internalNginx.resolveGeoAccess(geoSettings, stream, "stream");
			if (!geoAccess.enabled) {
				return;
			}
			const target = internalNginx.getStreamProxyPassTarget(stream);
			if (!target) {
				return;
			}
			streamEntries.push({
				id: stream.id,
				geo_access_mode: geoAccess.mode,
				geo_access_countries: geoAccess.countries,
				geo_access_target: target,
				geo_access_variable: internalNginx.getStreamGeoAccessVariable(stream.id),
			});
		});

		if (!streamEntries.length && !streamPortMaps.length) {
			fs.writeFileSync(filename, "# Stream GeoIP2 disabled\n", { encoding: "utf8" });
			return;
		}

		const template = readTemplate("stream_geo.conf");
		try {
			const configText = await renderEngine.parseAndRender(template, {
				streams: streamEntries,
				stream_port_maps: streamPortMaps,
			});
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
		const blockExploitsConfig = blockExploitsGeneratedPath;
		const blockExploitsBackup = `${backupRoot}/block-exploits.conf`;
		const geoHttpConfig = "/etc/nginx/conf.d/include/geoip2_http.conf";
		const geoStreamConfig = "/etc/nginx/conf.d/include/geoip2_stream.conf";
		const streamGeoConfig = "/etc/nginx/conf.d/include/stream_geo.conf";
		const geoHttpBackup = `${backupRoot}/geoip2_http.conf`;
		const geoStreamBackup = `${backupRoot}/geoip2_stream.conf`;
		const streamGeoBackup = `${backupRoot}/stream_geo.conf`;

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
			if (fs.existsSync(blockExploitsConfig)) {
				fs.copyFileSync(blockExploitsConfig, blockExploitsBackup);
			}
			if (fs.existsSync(geoHttpConfig)) {
				fs.copyFileSync(geoHttpConfig, geoHttpBackup);
			}
			if (fs.existsSync(geoStreamConfig)) {
				fs.copyFileSync(geoStreamConfig, geoStreamBackup);
			}
			if (fs.existsSync(streamGeoConfig)) {
				fs.copyFileSync(streamGeoConfig, streamGeoBackup);
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
			if (fs.existsSync(blockExploitsBackup)) {
				fs.copyFileSync(blockExploitsBackup, blockExploitsConfig);
			}
			if (fs.existsSync(geoHttpBackup)) {
				fs.copyFileSync(geoHttpBackup, geoHttpConfig);
			}
			if (fs.existsSync(geoStreamBackup)) {
				fs.copyFileSync(geoStreamBackup, geoStreamConfig);
			}
			if (fs.existsSync(streamGeoBackup)) {
				fs.copyFileSync(streamGeoBackup, streamGeoConfig);
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

			await internalNginx.generateBlockExploitsConfig();
			await internalNginx.generateRateLimitConfig();
			await internalNginx.generateGeoConfig();
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
