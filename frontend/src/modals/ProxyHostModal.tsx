import { IconSettings } from "@tabler/icons-react";
import cn from "classnames";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik, useFormikContext } from "formik";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import type { ProxyHostHeartbeatResult } from "src/api/backend";
import {
	AccessField,
	Button,
	CountryChecklist,
	DomainNamesField,
	HasPermission,
	Loading,
	LocationsFields,
	NginxConfigField,
	SecurityHeadersFields,
	SSLCertificateField,
	SSLOptionsFields,
} from "src/components";
import { type HeartbeatTarget, useDebouncedHeartbeats } from "src/hooks/useDebouncedHeartbeats";
import { validateUpstreamServers } from "./proxyHostValidation";
import { useProxyHost, useSetProxyHost, useSetting, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import { validateNumber, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const validateForwardHost = validateString(1, 255);
const validateForwardPort = validateNumber(1, 65535);
const defaultListenPorts = [80, 443];

const normalizeListenPortsInput = (value: unknown) => {
	if (value === null || typeof value === "undefined") {
		return { ports: [...defaultListenPorts], hasValue: false };
	}
	const raw = `${value}`.trim();
	if (!raw) {
		return { ports: [], hasValue: true };
	}
	const parts = raw
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	const parsedPorts = parts
		.map((part) => Number.parseInt(part, 10))
		.filter((port) => Number.isFinite(port) && port >= 1 && port <= 65535);
	const uniquePorts = Array.from(new Set<number>(parsedPorts)).sort((a, b) => a - b);
	return { ports: uniquePorts, hasValue: true };
};

const validateProxyHost = (values: any) => {
	const errors = {
		...validateUpstreamServers(values),
	};
	const geoState = values.geoAccessOverride
		? values.geoAccessEnabled
			? "enabled"
			: "disabled"
		: "inherit";
	if (geoState === "enabled" && !values.geoAccessPreset) {
		const countries = Array.isArray(values.geoAccessCountries) ? values.geoAccessCountries : [];
		if ((values.geoAccessMode || "allow") === "allow" && countries.length === 0) {
			errors.geoAccessCountries = "error.geo-access.countries-required";
		}
	}
	return errors;
};

const showProxyHostModal = (id: number | "new") => {
	EasyModal.show(ProxyHostModal, { id });
};

interface Props extends InnerModalProps {
	id: number | "new";
}

const ForwardHeartbeatCheck = ({
	refreshKey,
	onRefresh,
}: {
	refreshKey: number;
	onRefresh: () => void;
}) => {
	const { values } = useFormikContext<any>();

	const targets = useMemo(() => {
		const upstreamServers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
		const selectedHost = values.upstreamEnabled && upstreamServers.length ? upstreamServers[0] : null;
		const forwardHost = `${selectedHost?.host || values.forwardHost || ""}`.trim();
		const forwardPort = Number.parseInt(`${selectedHost?.port || values.forwardPort || ""}`, 10);
		const forwardScheme = values.forwardScheme || "http";

		if (!forwardHost || !Number.isFinite(forwardPort) || forwardPort < 1 || forwardPort > 65535) {
			return [];
		}

		return [
			{
				forwardScheme,
				forwardHost,
				forwardPort,
			},
		];
	}, [
		values.forwardHost,
		values.forwardPort,
		values.forwardScheme,
		values.upstreamEnabled,
		values.upstreamServers,
	]);

	const heartbeatState = useDebouncedHeartbeats(targets, refreshKey);
	const result = heartbeatState.results[0];
	const status = (() => {
		if (!targets.length) {
			return "idle";
		}
		if (heartbeatState.status === "checking") {
			return "checking";
		}
		if (heartbeatState.status === "error") {
			return "failed";
		}
		if (result?.ok) {
			return "ok";
		}
		if (result) {
			return "failed";
		}
		return "idle";
	})();

	const latencyMs = Number.isFinite(result?.latencyMs) ? Math.round(result?.latencyMs || 0) : null;
	const statusClass =
		status === "ok" ? "text-success" : status === "failed" ? "text-danger" : "text-muted";
	const statusLabel =
		status === "checking" ? (
			<T id="host.heartbeat.status.checking" />
		) : status === "ok" ? (
			<T id="host.heartbeat.status.ok" />
		) : status === "failed" ? (
			<T id="host.heartbeat.status.failed" />
		) : (
			<T id="host.heartbeat.status.waiting" />
		);

	const errorMessage =
		status === "failed"
			? heartbeatState.status === "error"
				? heartbeatState.error
				: result?.error
			: undefined;

	return (
		<div className="mb-3">
			<button
				type="button"
				className={`btn btn-link p-0 text-decoration-none small ${statusClass}`}
				onClick={onRefresh}
			>
				<T id="host.heartbeat" />: {statusLabel}
				{status === "ok" && latencyMs !== null ? <span> ({latencyMs}ms)</span> : null}
			</button>
			{status === "failed" && errorMessage ? (
				<div className="small text-muted text-break">{errorMessage}</div>
			) : null}
		</div>
	);
};

const UpstreamSettings = ({ onRequestForwardHeartbeat }: { onRequestForwardHeartbeat: () => void }) => {
	const { values, setFieldValue, errors, submitCount } = useFormikContext<any>();
	const servers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
	const upstreamInvalid = submitCount > 0 && !!errors.upstreamServers;
	const [upstreamRefresh, setUpstreamRefresh] = useState(0);

	useEffect(() => {
		if (!values.upstreamEnabled || servers.length === 0) {
			return;
		}
		const primary = servers[0] || {};
		const nextHost = `${primary.host || ""}`.trim();
		const parsedPort = Number.parseInt(`${primary.port || ""}`, 10);
		const nextPort = Number.isFinite(parsedPort) ? parsedPort : 0;

		if (values.forwardHost !== nextHost) {
			setFieldValue("forwardHost", nextHost);
		}
		if (values.forwardPort !== nextPort) {
			setFieldValue("forwardPort", nextPort);
		}
	}, [servers, setFieldValue, values.forwardHost, values.forwardPort, values.upstreamEnabled]);

	const upstreamTargets = useMemo(() => {
		if (!values.upstreamEnabled || servers.length === 0) {
			return [];
		}

		const forwardScheme = values.forwardScheme || "http";
		return servers
			.map((server: any, idx: number) => {
				const host = `${server?.host || ""}`.trim();
				const port = Number.parseInt(`${server?.port || ""}`, 10);
				if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
					return null;
				}
				return {
					id: idx + 1,
					forwardScheme,
					forwardHost: host,
					forwardPort: port,
				};
			})
			.filter(Boolean) as HeartbeatTarget[];
	}, [servers, values.forwardScheme, values.upstreamEnabled]);

	const upstreamState = useDebouncedHeartbeats(upstreamTargets, upstreamRefresh);
	const upstreamChecking = upstreamTargets.length > 0 && upstreamState.status === "checking";
	const upstreamHeartbeats = useMemo(() => {
		const next: Record<number, ProxyHostHeartbeatResult> = {};
		upstreamState.results.forEach((result) => {
			if (typeof result.id !== "number") {
				return;
			}
			const index = result.id - 1;
			if (index >= 0) {
				next[index] = result;
			}
		});
		return next;
	}, [upstreamState.results]);

	const handleUpstreamRefresh = () => {
		setUpstreamRefresh((prev) => prev + 1);
		onRequestForwardHeartbeat();
	};

	const renderHeartbeatBadge = (server: any, idx: number) => {
		const host = `${server?.host || ""}`.trim();
		const port = Number.parseInt(`${server?.port || ""}`, 10);
		const validTarget = host && Number.isFinite(port) && port > 0 && port <= 65535;
		const heartbeat = upstreamHeartbeats[idx];
		const latencyMs = Number.isFinite(heartbeat?.latencyMs) ? Math.round(heartbeat?.latencyMs || 0) : null;
		const resolvedStatus =
			heartbeat?.status ?? (heartbeat ? (heartbeat.ok ? "ok" : "failed") : undefined);

		const badge = (() => {
			if (!validTarget) {
				return { color: "secondary", label: <T id="host.heartbeat.status.waiting" /> };
			}
			if (upstreamChecking) {
				return { color: "yellow", label: <T id="host.heartbeat.status.checking" /> };
			}
			if (!heartbeat) {
				return { color: "secondary", label: <T id="host.heartbeat.status.unknown" /> };
			}
			if (resolvedStatus === "unsupported") {
				return { color: "secondary", label: <T id="host.heartbeat.status.unsupported" /> };
			}
			if (heartbeat.ok) {
				return { color: "lime", label: <T id="host.heartbeat.status.ok" /> };
			}
			return { color: "danger", label: <T id="host.heartbeat.status.failed" /> };
		})();

		const title =
			!heartbeat?.ok && heartbeat?.error
				? heartbeat.error
				: latencyMs !== null
					? `${latencyMs}ms`
					: undefined;

		return (
			<button
				type="button"
				className="btn btn-link p-0 text-decoration-none"
				onClick={handleUpstreamRefresh}
			>
				<span className={`badge bg-${badge.color}-lt`} title={title}>
					<T id="host.heartbeat" />: {badge.label}
					{badge.color === "lime" && latencyMs !== null ? <span> ({latencyMs}ms)</span> : null}
				</span>
			</button>
		);
	};

	const handleToggle = (checked: boolean) => {
		setFieldValue("upstreamEnabled", checked);
		if (checked && servers.length === 0 && values.forwardHost && values.forwardPort) {
			setFieldValue("upstreamServers", [
				{
					host: values.forwardHost,
					port: Number.parseInt(`${values.forwardPort}`, 10) || 80,
					weight: 1,
					maxFails: 0,
					failTimeout: 0,
					backup: false,
				},
			]);
		}
	};

	const handleAdd = () => {
		setFieldValue("upstreamServers", [
			...servers,
			{ host: "", port: 80, weight: 1, maxFails: 0, failTimeout: 0, backup: false },
		]);
	};

	const handleRemove = (idx: number) => {
		setFieldValue(
			"upstreamServers",
			servers.filter((_: any, i: number) => i !== idx),
		);
	};

	const handleChange = (idx: number, field: string, value: string | number | boolean) => {
		const next = servers.map((server: any, i: number) => (i === idx ? { ...server, [field]: value } : server));
		setFieldValue("upstreamServers", next);
	};

	return (
		<div className="my-3">
			<h4 className="py-2">
				<T id="host.upstream" />
			</h4>
			<label className="row" htmlFor="upstreamEnabled">
				<span className="col">
					<T id="host.upstream.enabled" />
				</span>
				<span className="col-auto">
					<input
						id="upstreamEnabled"
						type="checkbox"
						className="form-check-input"
						checked={!!values.upstreamEnabled}
						onChange={(e) => handleToggle(e.target.checked)}
					/>
				</span>
			</label>

			{values.upstreamEnabled ? (
				<>
					<div className="row mt-3">
						<div className="col-md-6">
							<label className="form-label" htmlFor="upstreamPolicy">
								<T id="host.upstream.policy" />
							</label>
							<select
								id="upstreamPolicy"
								className="form-control"
								value={values.upstreamPolicy || "round_robin"}
								onChange={(e) => setFieldValue("upstreamPolicy", e.target.value)}
							>
								<option value="round_robin">
									<T id="host.upstream.policy.round-robin" />
								</option>
								<option value="least_conn">
									<T id="host.upstream.policy.least-conn" />
								</option>
								<option value="ip_hash">
									<T id="host.upstream.policy.ip-hash" />
								</option>
							</select>
						</div>
					</div>

					<div className="mt-3">
						{servers.length ? (
							servers.map((server: any, idx: number) => (
								<div key={`upstream-${idx}`} className="mb-3">
									<div className="row g-2 align-items-center">
										<div className="col-md-4">
											<label className="form-label small" htmlFor={`upstream-host-${idx}`}>
												<T id="host.upstream.server" />
											</label>
											<input
												id={`upstream-host-${idx}`}
												type="text"
												className={`form-control ${upstreamInvalid ? "is-invalid" : ""}`}
												placeholder="example.local"
												value={server.host || ""}
												onChange={(e) => handleChange(idx, "host", e.target.value)}
											/>
										</div>
										<div className="col-md-2">
											<label className="form-label small" htmlFor={`upstream-port-${idx}`}>
												<T id="host.upstream.port" />
											</label>
											<input
												id={`upstream-port-${idx}`}
												type="number"
												min={1}
												max={65535}
												className={`form-control ${upstreamInvalid ? "is-invalid" : ""}`}
												placeholder="80"
												value={server.port ?? ""}
												onChange={(e) => {
													const raw = e.target.value;
													handleChange(idx, "port", raw === "" ? "" : Number.parseInt(raw, 10));
												}}
											/>
										</div>
										<div className="col-md-2">
											<label className="form-label small" htmlFor={`upstream-weight-${idx}`}>
												<T id="host.upstream.weight" />
											</label>
											<input
												id={`upstream-weight-${idx}`}
												type="number"
												min={1}
												max={100}
												className={`form-control ${upstreamInvalid ? "is-invalid" : ""}`}
												placeholder="1"
												value={server.weight || 1}
												onChange={(e) =>
													handleChange(idx, "weight", Number.parseInt(e.target.value, 10) || 1)
												}
											/>
										</div>
										<div className="col-md-2">
											<label className="form-label small" htmlFor={`upstream-max-fails-${idx}`}>
												<T id="host.upstream.max-fails" />
											</label>
											<input
												id={`upstream-max-fails-${idx}`}
												type="number"
												min={0}
												max={100}
												className={`form-control ${upstreamInvalid ? "is-invalid" : ""}`}
												placeholder="0"
												value={server.maxFails || 0}
												onChange={(e) =>
													handleChange(idx, "maxFails", Number.parseInt(e.target.value, 10) || 0)
												}
											/>
										</div>
										<div className="col-md-2">
											<label className="form-label small" htmlFor={`upstream-fail-timeout-${idx}`}>
												<T id="host.upstream.fail-timeout" />
											</label>
											<input
												id={`upstream-fail-timeout-${idx}`}
												type="number"
												min={0}
												max={3600}
												className={`form-control ${upstreamInvalid ? "is-invalid" : ""}`}
												placeholder="0"
												value={server.failTimeout || 0}
												onChange={(e) =>
													handleChange(idx, "failTimeout", Number.parseInt(e.target.value, 10) || 0)
												}
											/>
										</div>
									</div>
									<div className="row g-2 align-items-center mt-2">
										<div className="col-md-4">
											<div className="form-check">
												<input
													className="form-check-input"
													type="checkbox"
													id={`upstream-backup-${idx}`}
													checked={!!server.backup}
													onChange={(e) => handleChange(idx, "backup", e.target.checked)}
												/>
												<label className="form-check-label" htmlFor={`upstream-backup-${idx}`}>
													<T id="host.upstream.backup" />
												</label>
											</div>
										</div>
										<div className="col-md-8 text-end">
											<div className="d-flex justify-content-end align-items-center gap-2">
												{renderHeartbeatBadge(server, idx)}
												<button type="button" className="btn btn-sm" onClick={() => handleRemove(idx)}>
													<T id="action.delete" />
												</button>
											</div>
										</div>
									</div>
								</div>
							))
						) : (
							<div className="text-muted small mb-2">
								<T id="host.upstream.empty" />
							</div>
						)}
						<button type="button" className="btn btn-sm" onClick={handleAdd}>
							<T id="host.upstream.add" />
						</button>
						{submitCount > 0 && errors.upstreamServers ? (
							<div className="text-danger small mt-2">
								<T id={errors.upstreamServers as string} />
							</div>
						) : null}
					</div>
				</>
			) : null}
		</div>
	);
};

const ProxyHostModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data: currentUser, isLoading: userIsLoading, error: userError } = useUser("me");
	const { data, isLoading, error } = useProxyHost(id);
	const { mutate: setProxyHost } = useSetProxyHost();
	const { data: geoAccessSetting } = useSetting("geo-access");
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [forwardHeartbeatKey, setForwardHeartbeatKey] = useState(0);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		setErrorMsg(null);

		const normalizedListenPorts = normalizeListenPortsInput(values.listenPorts);
		const restValues = {
			...values,
			geoAccessCountries: Array.isArray(values.geoAccessCountries) ? values.geoAccessCountries : [],
		};

		const { ...payload } = {
			id: id === "new" ? undefined : id,
			...restValues,
			listenPorts: normalizedListenPorts.ports.length ? normalizedListenPorts.ports : defaultListenPorts,
		};

		setSubmitting(true);
		setProxyHost(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("proxy-host", "saved");
				remove();
			},
			onSettled: () => {
				setSubmitting(false);
			},
		});
	};

	return (
		<Modal show={visible} onHide={remove} size="xl">
			{!isLoading && (error || userError) && (
				<Alert variant="danger" className="m-3">
					{error?.message || userError?.message || "Unknown error"}
				</Alert>
			)}
			{isLoading || (userIsLoading && <Loading noLogo />)}
			{!isLoading && !userIsLoading && data && currentUser && (
				<Formik
					key={id === "new" ? "new" : data?.id}
					initialValues={
						{
							// Details tab
							domainNames: data?.domainNames || [],
							forwardScheme: data?.forwardScheme || "http",
							forwardHost: data?.forwardHost || "",
							forwardPort: data?.forwardPort || undefined,
							listenPorts: (data?.listenPorts?.length ? data.listenPorts : defaultListenPorts).join(", "),
							accessListId: data?.accessListId || 0,
							cachingEnabled: data?.cachingEnabled || false,
							blockExploits: data?.blockExploits || false,
							rateLimitEnabled: data?.rateLimitEnabled || false,
							rateLimitRps: data?.rateLimitRps || 0,
							rateLimitBurst: data?.rateLimitBurst || 0,
							rateLimitNodelay: data?.rateLimitNodelay || false,
							upstreamEnabled: data?.upstreamEnabled || false,
							upstreamPolicy: data?.upstreamPolicy || "round_robin",
							upstreamServers: data?.upstreamServers || [],
							upstreamSslCertificateId: data?.upstreamSslCertificateId || 0,
							securityHeaders: data?.securityHeaders || [],
							geoAccessOverride: data?.geoAccessOverride || false,
							geoAccessEnabled: data?.geoAccessEnabled || false,
							geoAccessMode: data?.geoAccessMode || "allow",
							geoAccessPreset: data?.geoAccessPreset || "",
							geoAccessCountries: Array.isArray(data?.geoAccessCountries) ? data.geoAccessCountries : [],
							allowWebsocketUpgrade: data?.allowWebsocketUpgrade || false,
							// Locations tab
							locations: data?.locations || [],
							// SSL tab
							certificateId: data?.certificateId || 0,
							sslForced: data?.sslForced || false,
							http2Support: data?.http2Support || false,
							http3Support: data?.http3Support || false,
							hstsEnabled: data?.hstsEnabled || false,
							hstsSubdomains: data?.hstsSubdomains || false,
							// Advanced tab
							advancedConfig: data?.advancedConfig || "",
							meta: data?.meta || {},
						} as any
					}
					validate={validateProxyHost}
					onSubmit={onSubmit}
				>
					{({ values, setFieldValue, isSubmitting, errors, submitCount }: any) => {
						const labelForField = (key: string) => {
							switch (key) {
								case "domainNames":
									return intl.formatMessage({ id: "domain-names" });
								case "forwardHost":
									return intl.formatMessage({ id: "proxy-host.forward-host" });
								case "forwardPort":
									return intl.formatMessage({ id: "host.forward-port" });
								case "forwardScheme":
									return intl.formatMessage({ id: "host.forward-scheme" });
								case "listenPorts":
									return intl.formatMessage({ id: "host.listen-ports" });
								case "rateLimitRps":
									return intl.formatMessage({ id: "host.rate-limit.rps" });
								case "rateLimitBurst":
									return intl.formatMessage({ id: "host.rate-limit.burst" });
								case "upstreamServers":
									return intl.formatMessage({ id: "host.upstream" });
								case "locations":
									return intl.formatMessage({ id: "column.custom-locations" });
								case "geoAccessCountries":
									return intl.formatMessage({ id: "host.geo-access.countries" });
								default:
									return key.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
							}
						};
						const errorFields =
							submitCount > 0 && errors
								? Object.keys(errors).map((key) => labelForField(key))
								: [];
						const errorSummary = errorFields.length ? errorFields.join(", ") : null;
						const geoAccessState = values.geoAccessOverride
							? values.geoAccessEnabled
								? "enabled"
								: "disabled"
							: "inherit";
						const geoPresets = Array.isArray(geoAccessSetting?.meta?.presets)
							? geoAccessSetting.meta.presets
							: [];
						const selectedPreset = geoPresets.find(
							(preset: any) => preset.id === values.geoAccessPreset,
						);
						const geoAccessSource = values.geoAccessPreset && selectedPreset ? "preset" : "custom";

						return (
							<Form noValidate>
							<Modal.Header closeButton>
								<Modal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "proxy-host" }} />
								</Modal.Title>
							</Modal.Header>
							<Modal.Body className="p-0">
								<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
									{errorMsg}
								</Alert>
								<div className="card m-0 border-0">
									<div className="card-header">
										<ul className="nav nav-tabs card-header-tabs" data-bs-toggle="tabs">
											<li className="nav-item" role="presentation">
												<a
													href="#tab-details"
													className="nav-link active"
													data-bs-toggle="tab"
													aria-selected="true"
													role="tab"
												>
													<T id="column.details" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-locations"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.custom-locations" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-ssl"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="column.ssl" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-rate-limit"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="host.rate-limit" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-security-headers"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="host.headers" />
												</a>
											</li>
											<li className="nav-item" role="presentation">
												<a
													href="#tab-upstream-mtls"
													className="nav-link"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<T id="host.upstream.mtls" />
												</a>
											</li>
											<li className="nav-item ms-auto" role="presentation">
												<a
													href="#tab-advanced"
													className="nav-link"
													title="Settings"
													data-bs-toggle="tab"
													aria-selected="false"
													tabIndex={-1}
													role="tab"
												>
													<IconSettings size={20} />
												</a>
											</li>
										</ul>
									</div>
									<div className="card-body">
										{submitCount > 0 && Object.keys(errors).length ? (
											<Alert variant="warning">
												{errorSummary ? (
													<T id="error.fix-validation-fields" tData={{ fields: errorSummary }} />
												) : (
													<T id="error.fix-validation" />
												)}
											</Alert>
										) : null}
										<div className="tab-content">
											<div className="tab-pane active show" id="tab-details" role="tabpanel">
												<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported />
												<div className="row">
													<div className="col-md-3">
														<Field name="forwardScheme">
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardScheme"
																	>
																		<T id="host.forward-scheme" />
																	</label>
																	<select
																		id="forwardScheme"
																		className={`form-control ${form.errors.forwardScheme && form.touched.forwardScheme ? "is-invalid" : ""}`}
																		required
																		{...field}
																	>
																		<option value="http">http</option>
																		<option value="https">https</option>
																	</select>
																	{form.errors.forwardScheme ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardScheme &&
																			form.touched.forwardScheme
																				? form.errors.forwardScheme
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-6">
													<Field
														name="forwardHost"
														validate={(value: string) =>
															values.upstreamEnabled ? undefined : validateForwardHost(value)
														}
													>
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardHost">
																		<T id="proxy-host.forward-host" />
																	</label>
																<input
																	id="forwardHost"
																	type="text"
																	className={`form-control ${
																		form.errors.forwardHost &&
																		(form.touched.forwardHost || form.submitCount > 0)
																			? "is-invalid"
																			: ""
																	}`}
																	required
																	placeholder="example.com"
																	{...field}
																	disabled={form.values.upstreamEnabled}
																/>
																	{form.errors.forwardHost &&
																	(form.touched.forwardHost || form.submitCount > 0) ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardHost &&
																			(form.touched.forwardHost || form.submitCount > 0)
																				? form.errors.forwardHost
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-3">
													<Field
														name="forwardPort"
														validate={(value: string) =>
															values.upstreamEnabled ? undefined : validateForwardPort(value)
														}
													>
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label className="form-label" htmlFor="forwardPort">
																		<T id="host.forward-port" />
																	</label>
																<input
																	id="forwardPort"
																	type="number"
																	min={1}
																	max={65535}
																	className={`form-control ${
																		form.errors.forwardPort &&
																		(form.touched.forwardPort || form.submitCount > 0)
																			? "is-invalid"
																			: ""
																	}`}
																	required
																	placeholder="eg: 8081"
																	{...field}
																	disabled={form.values.upstreamEnabled}
																/>
																	{form.errors.forwardPort &&
																	(form.touched.forwardPort || form.submitCount > 0) ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardPort &&
																			(form.touched.forwardPort || form.submitCount > 0)
																				? form.errors.forwardPort
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
												</div>
											</div>
											<Field name="listenPorts">
												{({ field, form }: any) => (
													<div className="mb-3">
														<label className="form-label" htmlFor="listenPorts">
															<T id="host.listen-ports" />
														</label>
														<input
															{...field}
															id="listenPorts"
															type="text"
															placeholder="80, 443"
															className={`form-control ${
																form.errors.listenPorts &&
																(form.touched.listenPorts || form.submitCount > 0)
																	? "is-invalid"
																	: ""
															}`}
														/>
														{form.errors.listenPorts &&
														(form.touched.listenPorts || form.submitCount > 0) ? (
															<div className="invalid-feedback">{form.errors.listenPorts}</div>
														) : null}
														<div className="form-hint">
															<T id="host.listen-ports.help" />
														</div>
													</div>
												)}
											</Field>
											<ForwardHeartbeatCheck
												refreshKey={forwardHeartbeatKey}
												onRefresh={() => setForwardHeartbeatKey((prev) => prev + 1)}
											/>
									<UpstreamSettings
										onRequestForwardHeartbeat={() => setForwardHeartbeatKey((prev) => prev + 1)}
									/>
											<AccessField />
												<div className="my-3">
													<h4 className="py-2">
														<T id="options" />
													</h4>
													<div className="divide-y">
														<div>
															<label className="row" htmlFor="cachingEnabled">
																<span className="col">
																	<T id="host.flags.cache-assets" />
																</span>
																<span className="col-auto">
																	<Field name="cachingEnabled" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="cachingEnabled"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="blockExploits">
																<span className="col">
																	<T id="host.flags.block-exploits" />
																</span>
																<span className="col-auto">
																	<Field name="blockExploits" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="blockExploits"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="allowWebsocketUpgrade">
																<span className="col">
																	<T id="host.flags.websockets-upgrade" />
																</span>
																<span className="col-auto">
																	<Field name="allowWebsocketUpgrade" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="allowWebsocketUpgrade"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
												</div>
											</div>
											<div className="tab-pane" id="tab-locations" role="tabpanel">
												<LocationsFields initialValues={data?.locations || []} />
											</div>
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
												/>
												<SSLOptionsFields color="bg-lime" />
											</div>
											<div className="tab-pane" id="tab-rate-limit" role="tabpanel">
												<div className="mb-3">
													<h4 className="py-2">
														<T id="host.rate-limit" />
													</h4>
													<div className="divide-y">
														<div>
															<label className="row" htmlFor="rateLimitEnabled">
																<span className="col">
																	<T id="host.rate-limit.enabled" />
																</span>
																<span className="col-auto">
																	<Field name="rateLimitEnabled" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					{...field}
																					id="rateLimitEnabled"
																					className={cn("form-check-input", {
																						"bg-lime": field.checked,
																					})}
																					type="checkbox"
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
													</div>
													<div className="row mt-3">
														<div className="col-md-4">
															<Field name="rateLimitRps" validate={validateNumber(0, 100000)}>
																{({ field, form }: any) => (
																	<div className="mb-3">
																		<label className="form-label" htmlFor="rateLimitRps">
																			<T id="host.rate-limit.rps" />
																		</label>
																		<input
																			{...field}
																			id="rateLimitRps"
																			type="number"
																			min={0}
																			max={100000}
																			className={`form-control ${
																				form.errors.rateLimitRps &&
																				(form.touched.rateLimitRps || form.submitCount > 0)
																					? "is-invalid"
																					: ""
																			}`}
																			disabled={!form.values.rateLimitEnabled}
																		/>
																	</div>
																)}
															</Field>
														</div>
														<div className="col-md-4">
															<Field name="rateLimitBurst" validate={validateNumber(0, 100000)}>
																{({ field, form }: any) => (
																	<div className="mb-3">
																		<label className="form-label" htmlFor="rateLimitBurst">
																			<T id="host.rate-limit.burst" />
																		</label>
																		<input
																			{...field}
																			id="rateLimitBurst"
																			type="number"
																			min={0}
																			max={100000}
																			className={`form-control ${
																				form.errors.rateLimitBurst &&
																				(form.touched.rateLimitBurst || form.submitCount > 0)
																					? "is-invalid"
																					: ""
																			}`}
																			disabled={!form.values.rateLimitEnabled}
																		/>
																	</div>
																)}
															</Field>
														</div>
														<div className="col-md-4">
															<label className="form-check form-switch mt-4" htmlFor="rateLimitNodelay">
																<Field name="rateLimitNodelay" type="checkbox">
																	{({ field, form }: any) => (
																		<input
																			{...field}
																			id="rateLimitNodelay"
																			className="form-check-input"
																			type="checkbox"
																			disabled={!form.values.rateLimitEnabled}
																		/>
																	)}
																</Field>
																<span className="form-check-label">
																	<T id="host.rate-limit.nodelay" />
																</span>
															</label>
														</div>
													</div>
												</div>
											</div>
											<div className="tab-pane" id="tab-security-headers" role="tabpanel">
												<div className="mb-3">
													<h4 className="py-2">
														<T id="host.headers" />
													</h4>
													<SecurityHeadersFields
														headers={values.securityHeaders}
														onChange={(headers) => setFieldValue("securityHeaders", headers)}
														prefix="proxy-host-headers"
													/>
												</div>
											</div>
											<div className="tab-pane" id="tab-upstream-mtls" role="tabpanel">
												<div className="mb-3">
													<h4 className="py-2">
														<T id="host.upstream.mtls" />
													</h4>
													<SSLCertificateField
														name="upstreamSslCertificateId"
														label="host.upstream.mtls.certificate"
														allowNew
													/>
												</div>
											</div>
											<div className="tab-pane" id="tab-advanced" role="tabpanel">
												<div className="mb-4">
													<h4 className="py-2">
														<T id="host.geo-access" />
													</h4>
													<div className="row">
														<div className="col-md-4">
															<label className="form-label" htmlFor="geoAccessState">
																<T id="host.geo-access.state" />
															</label>
															<select
																id="geoAccessState"
																className="form-control"
																value={geoAccessState}
																onChange={(e) => {
																	const next = e.target.value;
																	if (next === "inherit") {
																		setFieldValue("geoAccessOverride", false);
																	} else {
																		setFieldValue("geoAccessOverride", true);
																		setFieldValue("geoAccessEnabled", next === "enabled");
																	}
																}}
															>
																<option value="inherit">
																	<T id="host.geo-access.inherit" />
																</option>
																<option value="enabled">
																	<T id="host.geo-access.enable" />
																</option>
																<option value="disabled">
																	<T id="host.geo-access.disable" />
																</option>
															</select>
														</div>
														{geoAccessState === "enabled" ? (
															<>
																<div className="col-md-4">
																	<label className="form-label" htmlFor="geoAccessSource">
																		<T id="host.geo-access.source" />
																	</label>
																	<select
																		id="geoAccessSource"
																		className="form-control"
																		value={geoAccessSource}
																		onChange={(e) => {
																			const next = e.target.value;
																			if (next === "preset") {
																				setFieldValue(
																					"geoAccessPreset",
																					geoPresets[0]?.id || "",
																				);
																			} else {
																				setFieldValue("geoAccessPreset", "");
																			}
																		}}
																	>
																		<option value="custom">
																			<T id="host.geo-access.source.custom" />
																		</option>
																		<option value="preset" disabled={geoPresets.length === 0}>
																			<T id="host.geo-access.source.preset" />
																		</option>
																	</select>
																</div>
																<div className="col-md-4">
																	{geoAccessSource === "preset" ? (
																		<>
																			<label
																				className="form-label"
																				htmlFor="geoAccessPreset"
																			>
																				<T id="host.geo-access.preset" />
																			</label>
																			<select
																				id="geoAccessPreset"
																				className="form-control"
																				value={values.geoAccessPreset || ""}
																				onChange={(e) =>
																					setFieldValue("geoAccessPreset", e.target.value)
																				}
																			>
																				{geoPresets.map((preset: any) => (
																					<option key={preset.id} value={preset.id}>
																						{preset.name}
																					</option>
																				))}
																			</select>
																		</>
																	) : (
																		<>
																			<label className="form-label" htmlFor="geoAccessMode">
																				<T id="host.geo-access.mode" />
																			</label>
																			<select
																				id="geoAccessMode"
																				className="form-control"
																				value={values.geoAccessMode || "allow"}
																				onChange={(e) =>
																					setFieldValue("geoAccessMode", e.target.value)
																				}
																			>
																				<option value="allow">
																					<T id="host.geo-access.mode.allow" />
																				</option>
																				<option value="deny">
																					<T id="host.geo-access.mode.deny" />
																				</option>
																			</select>
																		</>
																	)}
																</div>
																<div className="col-md-4">
																	{geoAccessSource === "preset" ? (
																		<>
																			<label className="form-label">
																				<T id="host.geo-access.mode" />
																			</label>
																			<input
																				type="text"
																				className="form-control"
																				value={
																					selectedPreset?.mode === "deny"
																						? intl.formatMessage({
																								id: "host.geo-access.mode.deny",
																							})
																						: intl.formatMessage({
																								id: "host.geo-access.mode.allow",
																							})
																				}
																				disabled
																			/>
																		</>
																	) : null}
																</div>
																<div className="col-12 mt-3">
																	<label className="form-label">
																		<T id="host.geo-access.countries" />
																	</label>
																	<CountryChecklist
																		value={
																			geoAccessSource === "preset"
																				? selectedPreset?.countries || []
																				: values.geoAccessCountries || []
																		}
																		onChange={(next) =>
																			setFieldValue("geoAccessCountries", next)
																		}
																		disabled={geoAccessSource === "preset"}
																	/>
																	{geoAccessSource !== "preset" &&
																	submitCount > 0 &&
																	errors.geoAccessCountries ? (
																		<div className="text-danger small mt-2">
																			<T id={errors.geoAccessCountries} />
																		</div>
																	) : null}
																	{geoAccessSource === "preset" &&
																	geoPresets.length === 0 ? (
																		<div className="text-muted small mt-2">
																			<T id="host.geo-access.presets.empty" />
																		</div>
																	) : null}
																</div>
															</>
														) : null}
													</div>
												</div>
												<NginxConfigField />
											</div>
										</div>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
									<Button
										type="submit"
										actionType="primary"
										className="ms-auto bg-lime"
										data-bs-dismiss="modal"
										isLoading={isSubmitting}
										disabled={isSubmitting}
									>
										<T id="save" />
									</Button>
								</HasPermission>
							</Modal.Footer>
						</Form>
						);
					}}
				</Formik>
			)}
		</Modal>
	);
});

export { showProxyHostModal };
