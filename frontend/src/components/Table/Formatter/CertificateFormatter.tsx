import { differenceInDays, isPast } from "date-fns";
import type { Certificate } from "src/api/backend";
import { parseDate, T } from "src/locale";

interface Props {
	certificate?: Certificate;
	domainNames?: string[];
}
const normalizeDomain = (domain: string) => domain.trim().toLowerCase().replace(/\.$/, "");

const coversDomain = (certDomain: string, hostDomain: string) => {
	const normalizedCert = normalizeDomain(certDomain);
	const normalizedHost = normalizeDomain(hostDomain);
	if (!normalizedCert || !normalizedHost) {
		return false;
	}
	if (normalizedCert === normalizedHost) {
		return true;
	}
	if (normalizedCert.startsWith("*.") && normalizedCert.length > 2) {
		const suffix = normalizedCert.slice(2);
		if (!normalizedHost.endsWith(`.${suffix}`)) {
			return false;
		}
		const hostParts = normalizedHost.split(".");
		const suffixParts = suffix.split(".");
		return hostParts.length === suffixParts.length + 1;
	}
	return false;
};

export function CertificateFormatter({ certificate, domainNames }: Props) {
	let translation = "http-only";
	let expiryBadge = null;
	let mismatchBadge = null;

	if (certificate) {
		translation = certificate.provider;
		if (translation === "letsencrypt") {
			translation = "lets-encrypt";
		} else if (translation === "other") {
			translation = "certificates.custom";
		}

		if (certificate.expiresOn) {
			const parsed = parseDate(certificate.expiresOn);
			if (parsed) {
				const expired = isPast(parsed);
				const daysLeft = differenceInDays(parsed, new Date());
				const badgeClass = expired ? "bg-danger-lt" : daysLeft <= 30 ? "bg-yellow-lt" : "bg-lime-lt";
				expiryBadge = (
					<span className={`badge ${badgeClass}`}>
						{expired ? <T id="certificates.expired" /> : <T id="certificates.expires-in-days" tData={{ days: daysLeft }} />}
					</span>
				);
			}
		}

		if (domainNames?.length && certificate.domainNames?.length) {
			const missing = domainNames.filter(
				(hostDomain) => !certificate.domainNames.some((certDomain) => coversDomain(certDomain, hostDomain)),
			);
			if (missing.length) {
				mismatchBadge = (
					<span className="badge bg-orange-lt" title={missing.join(", ")}>
						<T id="certificates.san-mismatch" />
					</span>
				);
			}
		}
	}
	if (!certificate) {
		return <T id={translation} />;
	}

	return (
		<span className="d-inline-flex align-items-center gap-2">
			<T id={translation} />
			{expiryBadge}
			{mismatchBadge}
		</span>
	);
}
