import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik, useFormikContext } from "formik";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import { checkStreamHeartbeats, type StreamHeartbeatResult } from "src/api/backend";
import { Button, Loading, SSLCertificateField, SSLOptionsFields } from "src/components";
import { useSetStream, useStream } from "src/hooks";
import { intl, T } from "src/locale";
import { validateNumber, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const validateForwardingHost = validateString(1, 255);
const validateForwardingPort = validateNumber(1, 65535);

const showStreamModal = (id: number | "new") => {
	EasyModal.show(StreamModal, { id });
};

interface Props extends InnerModalProps {
	id: number | "new";
}

const ForwardStreamHeartbeatCheck = ({
	refreshKey,
	onRefresh,
}: {
	refreshKey: number;
	onRefresh: () => void;
}) => {
	const { values } = useFormikContext<any>();
	const [state, setState] = useState<{
		status: "idle" | "checking" | "ok" | "failed" | "unsupported";
		result?: StreamHeartbeatResult;
		error?: string;
	}>({ status: "idle" });
	const requestId = useRef(0);

	useEffect(() => {
		void refreshKey;
		const upstreamServers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
		const selectedHost = values.upstreamEnabled && upstreamServers.length ? upstreamServers[0] : null;
		const forwardingHost = `${selectedHost?.host || values.forwardingHost || ""}`.trim();
		const forwardingPort = Number.parseInt(`${selectedHost?.port || values.forwardingPort || ""}`, 10);
		const tcpForwarding = !!values.tcpForwarding;
		const udpForwarding = !!values.udpForwarding;

		if (
			!forwardingHost ||
			!Number.isFinite(forwardingPort) ||
			forwardingPort < 1 ||
			forwardingPort > 65535
		) {
			setState({ status: "idle" });
			return;
		}

		if (!tcpForwarding && udpForwarding) {
			setState({ status: "unsupported" });
			return;
		}

		if (!tcpForwarding && !udpForwarding) {
			setState({ status: "idle" });
			return;
		}

		const currentRequest = ++requestId.current;
		const abortController = new AbortController();
		setState({ status: "checking" });

		const timer = setTimeout(() => {
			checkStreamHeartbeats(
				[
					{
						forwardingHost,
						forwardingPort,
						tcpForwarding,
						udpForwarding,
					},
				],
				abortController,
			)
				.then((results) => {
					if (requestId.current !== currentRequest) return;
					const result = results[0];
					if (result?.status === "unsupported") {
						setState({ status: "unsupported", result, error: result?.error });
					} else if (result?.ok) {
						setState({ status: "ok", result });
					} else {
						setState({ status: "failed", result, error: result?.error });
					}
				})
				.catch((err: Error) => {
					if (requestId.current !== currentRequest) return;
					setState({ status: "failed", error: err.message });
				});
		}, 500);

		return () => {
			clearTimeout(timer);
			abortController.abort();
		};
	}, [
		values.forwardingHost,
		values.forwardingPort,
		values.tcpForwarding,
		values.udpForwarding,
		values.upstreamEnabled,
		values.upstreamServers,
		refreshKey,
	]);

	const latencyMs = Number.isFinite(state.result?.latencyMs) ? Math.round(state.result?.latencyMs || 0) : null;
	const statusClass =
		state.status === "ok"
			? "text-success"
			: state.status === "failed"
				? "text-danger"
				: state.status === "unsupported"
					? "text-muted"
					: "text-muted";
	const statusLabel =
		state.status === "checking" ? (
			<T id="host.heartbeat.status.checking" />
		) : state.status === "ok" ? (
			<T id="host.heartbeat.status.ok" />
		) : state.status === "failed" ? (
			<T id="host.heartbeat.status.failed" />
		) : state.status === "unsupported" ? (
			<T id="host.heartbeat.status.unsupported" />
		) : (
			<T id="host.heartbeat.status.waiting" />
		);

	return (
		<div className="mb-3">
			<button
				type="button"
				className={`btn btn-link p-0 text-decoration-none small ${statusClass}`}
				onClick={onRefresh}
			>
				<T id="host.heartbeat" />: {statusLabel}
				{state.status === "ok" && latencyMs !== null ? <span> ({latencyMs}ms)</span> : null}
			</button>
			{state.status === "failed" && state.error ? (
				<div className="small text-muted text-break">{state.error}</div>
			) : null}
		</div>
	);
};

const UpstreamSettings = ({ onRequestForwardHeartbeat }: { onRequestForwardHeartbeat: () => void }) => {
	const { values, setFieldValue, errors, submitCount } = useFormikContext<any>();
	const servers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
	const upstreamInvalid = submitCount > 0 && !!errors.upstreamServers;
	const [upstreamHeartbeats, setUpstreamHeartbeats] = useState<Record<number, StreamHeartbeatResult>>({});
	const [upstreamChecking, setUpstreamChecking] = useState(false);
	const upstreamRequestId = useRef(0);
	const [upstreamRefresh, setUpstreamRefresh] = useState(0);

	useEffect(() => {
		if (!values.upstreamEnabled || servers.length === 0) {
			return;
		}
		const primary = servers[0] || {};
		const nextHost = `${primary.host || ""}`.trim();
		const parsedPort = Number.parseInt(`${primary.port || ""}`, 10);
		const nextPort = Number.isFinite(parsedPort) ? parsedPort : 0;

		if (values.forwardingHost !== nextHost) {
			setFieldValue("forwardingHost", nextHost);
		}
		if (values.forwardingPort !== nextPort) {
			setFieldValue("forwardingPort", nextPort);
		}
	}, [servers, setFieldValue, values.forwardingHost, values.forwardingPort, values.upstreamEnabled]);

	useEffect(() => {
		void upstreamRefresh;
		if (!values.upstreamEnabled || servers.length === 0) {
			setUpstreamHeartbeats({});
			setUpstreamChecking(false);
			return;
		}

		const tcpForwarding = !!values.tcpForwarding;
		const udpForwarding = !!values.udpForwarding;
		if (!tcpForwarding && !udpForwarding) {
			setUpstreamHeartbeats({});
			setUpstreamChecking(false);
			return;
		}

		const targets = servers
			.map((server: any, idx: number) => {
				const host = `${server?.host || ""}`.trim();
				const port = Number.parseInt(`${server?.port || ""}`, 10);
				if (!host || !Number.isFinite(port) || port < 1 || port > 65535) {
					return null;
				}
				return {
					id: idx + 1,
					forwardingHost: host,
					forwardingPort: port,
					tcpForwarding,
					udpForwarding,
				};
			})
			.filter(Boolean) as {
			id: number;
			forwardingHost: string;
			forwardingPort: number;
			tcpForwarding: boolean;
			udpForwarding: boolean;
		}[];

		if (!targets.length) {
			setUpstreamHeartbeats({});
			setUpstreamChecking(false);
			return;
		}

		let active = true;
		const currentRequest = ++upstreamRequestId.current;
		const abortController = new AbortController();
		setUpstreamChecking(true);

		const timer = setTimeout(() => {
			checkStreamHeartbeats(targets, abortController)
				.then((results) => {
					if (!active || upstreamRequestId.current !== currentRequest) return;
					const next: Record<number, StreamHeartbeatResult> = {};
					results.forEach((result) => {
						if (typeof result.id !== "number") {
							return;
						}
						const index = result.id - 1;
						if (index >= 0) {
							next[index] = result;
						}
					});
					setUpstreamHeartbeats(next);
				})
				.catch(() => {
					if (active) {
						setUpstreamHeartbeats({});
					}
				})
				.finally(() => {
					if (active) {
						setUpstreamChecking(false);
					}
				});
		}, 500);

		return () => {
			active = false;
			clearTimeout(timer);
			abortController.abort();
		};
	}, [servers, values.tcpForwarding, values.udpForwarding, values.upstreamEnabled, upstreamRefresh]);

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
		if (checked && servers.length === 0 && values.forwardingHost && values.forwardingPort) {
			setFieldValue("upstreamServers", [
				{
					host: values.forwardingHost,
					port: Number.parseInt(`${values.forwardingPort}`, 10) || 80,
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

const StreamModal = EasyModal.create(({ id, visible, remove }: Props) => {
	const { data, isLoading, error } = useStream(id);
	const { mutate: setStream } = useSetStream();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [forwardHeartbeatKey, setForwardHeartbeatKey] = useState(0);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const { ...payload } = {
			id: id === "new" ? undefined : id,
			...values,
		};

		setStream(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("stream", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<Modal show={visible} onHide={remove} size="xl">
			{!isLoading && error && (
				<Alert variant="danger" className="m-3">
					{error?.message || "Unknown error"}
				</Alert>
			)}
			{isLoading && <Loading noLogo />}
			{!isLoading && data && (
				<Formik
					initialValues={
						{
							incomingPort: data?.incomingPort,
							forwardingHost: data?.forwardingHost,
							forwardingPort: data?.forwardingPort,
							upstreamEnabled: data?.upstreamEnabled || false,
							upstreamPolicy: data?.upstreamPolicy || "round_robin",
							upstreamServers: data?.upstreamServers || [],
							tcpForwarding: data?.tcpForwarding,
							udpForwarding: data?.udpForwarding,
							proxyProtocol: data?.proxyProtocol || false,
							proxyProtocolUpstream: data?.proxyProtocolUpstream || false,
							certificateId: data?.certificateId,
							meta: data?.meta || {},
						} as any
					}
					validate={(values: any) => {
						const errors: Record<string, string> = {};
						if (values.upstreamEnabled) {
							const servers = Array.isArray(values.upstreamServers) ? values.upstreamServers : [];
							const hasValidServer = servers.some((server: any) => {
								const host = `${server?.host || ""}`.trim();
								const port = Number.parseInt(`${server?.port || ""}`, 10);
								return host && Number.isFinite(port) && port > 0;
							});
							if (!hasValidServer) {
								errors.upstreamServers = "error.upstream-required";
							}
						}
						return errors;
					}}
					onSubmit={onSubmit}
				>
					{({ setFieldValue, errors, submitCount, values }: any) => {
						const errorFields =
							submitCount > 0 && errors
								? Object.keys(errors).map((key) => {
										switch (key) {
											case "incomingPort":
												return intl.formatMessage({ id: "stream.incoming-port" });
											case "forwardingHost":
												return intl.formatMessage({ id: "stream.forward-host" });
											case "forwardingPort":
												return intl.formatMessage({ id: "host.forward-port" });
											case "upstreamServers":
												return intl.formatMessage({ id: "host.upstream" });
											default:
												return key;
										}
								  })
								: [];
						const errorSummary = errorFields.length ? errorFields.join(", ") : null;

						return (
						<Form noValidate>
							<Modal.Header closeButton>
								<Modal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "stream" }} />
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
												<Field name="incomingPort" validate={validateNumber(1, 65535)}>
													{({ field, form }: any) => (
														<div className="mb-3">
															<label className="form-label" htmlFor="incomingPort">
																<T id="stream.incoming-port" />
															</label>
															<input
																id="incomingPort"
																type="number"
																min={1}
																max={65535}
																className={`form-control ${
																	form.errors.incomingPort &&
																	(form.touched.incomingPort || form.submitCount > 0)
																		? "is-invalid"
																		: ""
																}`}
																required
																placeholder="eg: 8080"
																{...field}
															/>
															{form.errors.incomingPort ? (
																<div className="invalid-feedback">
																	{form.errors.incomingPort &&
																	(form.touched.incomingPort || form.submitCount > 0)
																		? form.errors.incomingPort
																		: null}
																</div>
															) : null}
														</div>
													)}
												</Field>
												<div className="row">
													<div className="col-md-8">
														<Field
															name="forwardingHost"
															validate={(value: string) =>
																values.upstreamEnabled ? undefined : validateForwardingHost(value)
															}
														>
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardingHost"
																	>
																		<T id="stream.forward-host" />
																	</label>
																	<input
																		id="forwardingHost"
																		type="text"
																		className={`form-control ${
																			form.errors.forwardingHost &&
																			(form.touched.forwardingHost || form.submitCount > 0)
																				? "is-invalid"
																				: ""
																		}`}
																		required
																		placeholder="example.com or 10.0.0.1 or 2001:db8:3333:4444:5555:6666:7777:8888"
																		{...field}
																		disabled={form.values.upstreamEnabled}
																	/>
																	{form.errors.forwardingHost ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardingHost &&
																			(form.touched.forwardingHost || form.submitCount > 0)
																				? form.errors.forwardingHost
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
													</div>
													<div className="col-md-4">
														<Field
															name="forwardingPort"
															validate={(value: string) =>
																values.upstreamEnabled ? undefined : validateForwardingPort(value)
															}
														>
															{({ field, form }: any) => (
																<div className="mb-3">
																	<label
																		className="form-label"
																		htmlFor="forwardingPort"
																	>
																		<T id="host.forward-port" />
																	</label>
																	<input
																		id="forwardingPort"
																		type="number"
																		min={1}
																		max={65535}
																		className={`form-control ${
																			form.errors.forwardingPort &&
																			(form.touched.forwardingPort || form.submitCount > 0)
																				? "is-invalid"
																				: ""
																		}`}
																		required
																		placeholder="eg: 8081"
																		{...field}
																		disabled={form.values.upstreamEnabled}
																	/>
																	{form.errors.forwardingPort ? (
																		<div className="invalid-feedback">
																			{form.errors.forwardingPort &&
																			(form.touched.forwardingPort || form.submitCount > 0)
																				? form.errors.forwardingPort
																				: null}
																		</div>
																	) : null}
																</div>
															)}
														</Field>
											</div>
									</div>
									<ForwardStreamHeartbeatCheck
										refreshKey={forwardHeartbeatKey}
										onRefresh={() => setForwardHeartbeatKey((prev) => prev + 1)}
									/>
									<UpstreamSettings
										onRequestForwardHeartbeat={() => setForwardHeartbeatKey((prev) => prev + 1)}
									/>
									<div className="my-3">
										<h3 className="py-2">
											<T id="host.flags.protocols" />
													</h3>
													<div className="divide-y">
														<div>
															<label className="row" htmlFor="tcpForwarding">
																<span className="col">
																	<T id="streams.tcp" />
																</span>
																<span className="col-auto">
																	<Field name="tcpForwarding" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="tcpForwarding"
																					className="form-check-input"
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					onChange={(e: any) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																						if (!e.target.checked) {
																							setFieldValue(
																								"udpForwarding",
																								true,
																							);
																							setFieldValue(
																								"proxyProtocol",
																								false,
																							);
																							setFieldValue(
																								"proxyProtocolUpstream",
																								false,
																							);
																						}
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="udpForwarding">
																<span className="col">
																	<T id="streams.udp" />
																</span>
																<span className="col-auto">
																	<Field name="udpForwarding" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="udpForwarding"
																					className="form-check-input"
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					onChange={(e: any) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																						if (!e.target.checked) {
																							setFieldValue(
																								"tcpForwarding",
																								true,
																							);
																						}
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="proxyProtocol">
																<span className="col">
																	<T id="streams.proxy-protocol" />
																</span>
																<span className="col-auto">
																	<Field name="proxyProtocol" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="proxyProtocol"
																					className="form-check-input"
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					disabled={!values.tcpForwarding}
																					onChange={(e: any) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																					}}
																				/>
																			</label>
																		)}
																	</Field>
																</span>
															</label>
														</div>
														<div>
															<label className="row" htmlFor="proxyProtocolUpstream">
																<span className="col">
																	<T id="streams.proxy-protocol-upstream" />
																</span>
																<span className="col-auto">
																	<Field name="proxyProtocolUpstream" type="checkbox">
																		{({ field }: any) => (
																			<label className="form-check form-check-single form-switch">
																				<input
																					id="proxyProtocolUpstream"
																					className="form-check-input"
																					type="checkbox"
																					name={field.name}
																					checked={field.value}
																					disabled={!values.tcpForwarding}
																					onChange={(e: any) => {
																						setFieldValue(
																							field.name,
																							e.target.checked,
																						);
																					}}
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
											<div className="tab-pane" id="tab-ssl" role="tabpanel">
												<SSLCertificateField
													name="certificateId"
													label="ssl-certificate"
													allowNew
													forHttp={false}
												/>
												<SSLOptionsFields
													color="bg-blue"
													forHttp={false}
													forceDNSForNew
													requireDomainNames
												/>
											</div>
										</div>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<Button
									type="submit"
									actionType="primary"
									className="ms-auto"
									data-bs-dismiss="modal"
									isLoading={isSubmitting}
									disabled={isSubmitting}
								>
									<T id="save" />
								</Button>
							</Modal.Footer>
						</Form>
						);
					}}
				</Formik>
			)}
		</Modal>
	);
});

export { showStreamModal };
