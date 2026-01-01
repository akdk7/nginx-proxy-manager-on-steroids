import _ from "lodash";

/**
 * Makes sure that the ssl_* and hsts_* fields play nicely together.
 * ie: if there is no cert, then force_ssl is off.
 *     if force_ssl is off, then hsts_enabled is definitely off.
 *
 * @param   {object} data
 * @param   {object} [existingData]
 * @returns {object}
 */
const cleanSslHstsData = (data, existingData) => {
	const combinedData = _.assign({}, existingData || {}, data);

	if (!combinedData.certificate_id) {
		combinedData.ssl_forced = false;
		combinedData.http2_support = false;
	}

	if (!combinedData.ssl_forced) {
		combinedData.hsts_enabled = false;
	}

	if (!combinedData.hsts_enabled) {
		combinedData.hsts_subdomains = false;
	}

	return combinedData;
};

/**
 * used by the getAll functions of hosts, this removes the certificate meta if present
 *
 * @param   {Array}  rows
 * @returns {Array}
 */
const cleanAllRowsCertificateMeta = (rows) => {
	rows.forEach((row) => {
		if (typeof row.certificate !== "undefined" && row.certificate) {
			row.certificate.meta = {};
		}
	});

	return rows;
};

/**
 * used by the get/update functions of hosts, this removes the certificate meta if present
 *
 * @param   {Object}  row
 * @returns {Object}
 */
const cleanRowCertificateMeta = (row) => {
	if (typeof row.certificate !== "undefined" && row.certificate) {
		row.certificate.meta = {};
	}

	return row;
};

/**
 * Private call only
 *
 * @param   {String}  hostname
 * @param   {Array}   existingRows
 * @param   {Integer} [ignoreId]
 * @returns {Boolean}
 */
const checkHostnameRecordsTaken = (hostname, existingRows, ignoreId) => {
	const normalizedHostname = `${hostname}`.toLowerCase();
	return (
		existingRows?.some((existingRow) => {
			if (!Array.isArray(existingRow.domain_names)) {
				return false;
			}
			return existingRow.domain_names.some((existingHostname) => {
				// Does this domain match?
				if (`${existingHostname}`.toLowerCase() !== normalizedHostname) {
					return false;
				}
				return !ignoreId || ignoreId !== existingRow.id;
			});
		}) ?? false
	);
};

/**
 * Private call only
 *
 * @param   {Array}   hosts
 * @param   {Array}   domainNames
 * @returns {Array}
 */
const getHostsWithDomains = (hosts, domainNames) => {
	if (!Array.isArray(hosts) || !Array.isArray(domainNames) || domainNames.length === 0) {
		return [];
	}

	const domainSet = new Set(domainNames.map((domainName) => `${domainName}`.toLowerCase()));
	return hosts.filter((host) => {
		if (!Array.isArray(host.domain_names)) {
			return false;
		}
		return host.domain_names.some((hostDomainName) => domainSet.has(`${hostDomainName}`.toLowerCase()));
	});
};

export {
	cleanSslHstsData,
	cleanAllRowsCertificateMeta,
	cleanRowCertificateMeta,
	checkHostnameRecordsTaken,
	getHostsWithDomains,
};
