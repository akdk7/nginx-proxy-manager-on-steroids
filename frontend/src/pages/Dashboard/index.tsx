import {
	IconActivity,
	IconAlertTriangle,
	IconArrowsCross,
	IconBolt,
	IconBoltOff,
	IconClock,
	IconDisc,
	IconShield,
} from "@tabler/icons-react";
import { differenceInDays, isPast } from "date-fns";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { HasPermission } from "src/components";
import { EventFormatter } from "src/components/Table/Formatter/EventFormatter";
import { checkStreamHeartbeats, type StreamHeartbeatResult } from "src/api/backend";
import {
	useAuditLogs,
	useCertificates,
	useDeadHosts,
	useHostReport,
	useLogs,
	useProxyHosts,
	useRedirectionHosts,
	useStreams,
	useUser,
	useDebouncedHeartbeats,
} from "src/hooks";
import { formatDateTime, parseDate, T } from "src/locale";
import {
	ADMIN,
	CERTIFICATES,
	DEAD_HOSTS,
	PROXY_HOSTS,
	REDIRECTION_HOSTS,
	STREAMS,
	VIEW,
	hasPermission,
	isAdmin,
} from "src/modules/Permissions";

const heartbeatRefreshMs = 15000;
const certExpiryWarningDays = 30;
const errorLogLimit = 5;

const formatBytes = (value: number) => {
	if (!Number.isFinite(value)) {
		return "-";
	}
	const units = ["B", "KB", "MB", "GB", "TB"];
	let size = value;
	let idx = 0;
	while (size >= 1024 && idx < units.length - 1) {
		size /= 1024;
		idx += 1;
	}
	const decimals = idx === 0 ? 0 : 1;
	return `${size.toFixed(decimals)} ${units[idx]}`;
};

type StreamHeartbeatState = {
	status: "idle" | "checking" | "success" | "error";
	results: StreamHeartbeatResult[];
	error?: string;
};

const Dashboard = () => {
	const { data: hostReport } = useHostReport();
	const navigate = useNavigate();
	const { data: user } = useUser("me");
	const canViewProxy = hasPermission(PROXY_HOSTS, VIEW, user?.permissions, user?.roles);
	const canViewRedirection = hasPermission(REDIRECTION_HOSTS, VIEW, user?.permissions, user?.roles);
	const canViewStreams = hasPermission(STREAMS, VIEW, user?.permissions, user?.roles);
	const canViewDeadHosts = hasPermission(DEAD_HOSTS, VIEW, user?.permissions, user?.roles);
	const canViewCerts = hasPermission(CERTIFICATES, VIEW, user?.permissions, user?.roles);
	const canViewAdmin = isAdmin(user?.roles);

	const proxyHostsQuery = useProxyHosts(undefined, { enabled: canViewProxy });
	const redirectionHostsQuery = useRedirectionHosts(undefined, { enabled: canViewRedirection });
	const streamsQuery = useStreams(undefined, { enabled: canViewStreams });
	const deadHostsQuery = useDeadHosts(undefined, { enabled: canViewDeadHosts });
	const certificatesQuery = useCertificates(undefined, { enabled: canViewCerts });
	const auditLogsQuery = useAuditLogs(["user"], { enabled: canViewAdmin });
	const logsQuery = useLogs({ enabled: canViewAdmin });

	const [heartbeatRefreshKey, setHeartbeatRefreshKey] = useState(0);
	const streamHeartbeatRequestId = useRef(0);
	const [streamHeartbeatState, setStreamHeartbeatState] = useState<StreamHeartbeatState>({
		status: "idle",
		results: [],
	});

	useEffect(() => {
		const timer = setInterval(() => {
			setHeartbeatRefreshKey((prev) => prev + 1);
		}, heartbeatRefreshMs);
		return () => clearInterval(timer);
	}, []);

	const proxyTargets = useMemo(() => {
		if (!canViewProxy || !proxyHostsQuery.data?.length) {
			return [];
		}
		return proxyHostsQuery.data
			.filter((host) => host.enabled)
			.map((host) => ({
				id: host.id,
				forwardScheme: host.forwardScheme,
				forwardHost: host.forwardHost,
				forwardPort: host.forwardPort,
			}));
	}, [canViewProxy, proxyHostsQuery.data]);

	const proxyHeartbeat = useDebouncedHeartbeats(proxyTargets, heartbeatRefreshKey);

	const streamTargets = useMemo(() => {
		if (!canViewStreams || !streamsQuery.data?.length) {
			return [];
		}
		return streamsQuery.data
			.filter((stream) => stream.enabled)
			.map((stream) => ({
				id: stream.id,
				forwardingHost: stream.forwardingHost,
				forwardingPort: stream.forwardingPort,
				tcpForwarding: stream.tcpForwarding,
				udpForwarding: stream.udpForwarding,
			}));
	}, [canViewStreams, streamsQuery.data]);

	useEffect(() => {
		if (!streamTargets.length) {
			setStreamHeartbeatState({ status: "idle", results: [], error: undefined });
			return;
		}
		const currentRequest = ++streamHeartbeatRequestId.current;
		const abortController = new AbortController();
		setStreamHeartbeatState({ status: "checking", results: [], error: undefined });

		checkStreamHeartbeats(streamTargets, abortController)
			.then((results) => {
				if (streamHeartbeatRequestId.current !== currentRequest) return;
				setStreamHeartbeatState({ status: "success", results, error: undefined });
			})
			.catch((err: Error) => {
				if (streamHeartbeatRequestId.current !== currentRequest) return;
				setStreamHeartbeatState({ status: "error", results: [], error: err.message });
			});

		return () => {
			abortController.abort();
		};
	}, [streamTargets, heartbeatRefreshKey]);

	const statusLoading =
		(canViewProxy && proxyHostsQuery.isLoading) ||
		(canViewRedirection && redirectionHostsQuery.isLoading) ||
		(canViewStreams && streamsQuery.isLoading) ||
		(canViewDeadHosts && deadHostsQuery.isLoading);

	const statusTotals = useMemo(() => {
		const sets = [];
		if (canViewProxy && proxyHostsQuery.data) sets.push(proxyHostsQuery.data);
		if (canViewRedirection && redirectionHostsQuery.data) sets.push(redirectionHostsQuery.data);
		if (canViewStreams && streamsQuery.data) sets.push(streamsQuery.data);
		if (canViewDeadHosts && deadHostsQuery.data) sets.push(deadHostsQuery.data);
		let online = 0;
		let total = 0;
		sets.forEach((items) => {
			total += items.length;
			online += items.filter((item) => item.enabled).length;
		});
		return { online, offline: total - online, total };
	}, [
		canViewProxy,
		canViewRedirection,
		canViewStreams,
		canViewDeadHosts,
		proxyHostsQuery.data,
		redirectionHostsQuery.data,
		streamsQuery.data,
		deadHostsQuery.data,
	]);

	const certStats = useMemo(() => {
		const list = certificatesQuery.data || [];
		let expired = 0;
		let expiring = 0;
		list.forEach((cert) => {
			const parsed = parseDate(cert.expiresOn);
			if (!parsed) return;
			if (isPast(parsed)) {
				expired += 1;
				return;
			}
			const daysLeft = differenceInDays(parsed, new Date());
			if (daysLeft <= certExpiryWarningDays) {
				expiring += 1;
			}
		});
		return { expired, expiring, total: list.length };
	}, [certificatesQuery.data]);

	const auditEvents = useMemo(() => {
		if (!auditLogsQuery.data?.length) {
			return [];
		}
		return auditLogsQuery.data.slice(0, 5);
	}, [auditLogsQuery.data]);

	const errorLogs = useMemo(() => {
		const list = logsQuery.data || [];
		return list
			.filter((log) => log.name.includes("error.log"))
			.sort((a, b) => {
				const aTime = parseDate(a.modifiedOn)?.getTime() || 0;
				const bTime = parseDate(b.modifiedOn)?.getTime() || 0;
				return bTime - aTime;
			})
			.slice(0, errorLogLimit);
	}, [logsQuery.data]);

	const heartbeatCounts = useMemo(() => {
		const summarize = (results: { ok: boolean; status?: string }[]) => {
			let ok = 0;
			let failed = 0;
			let unsupported = 0;
			results.forEach((result) => {
				if (result.status === "unsupported") {
					unsupported += 1;
				} else if (result.ok) {
					ok += 1;
				} else {
					failed += 1;
				}
			});
			return { ok, failed, unsupported };
		};
		return {
			proxy: summarize(proxyHeartbeat.results),
			streams: summarize(streamHeartbeatState.results),
		};
	}, [proxyHeartbeat.results, streamHeartbeatState.results]);

	const canViewHosts = canViewProxy || canViewRedirection || canViewStreams || canViewDeadHosts;

	return (
		<div>
			<h2>
				<T id="dashboard" />
			</h2>
			<div className="row row-deck row-cards">
				<div className="col-12 my-4">
					<div className="row row-cards">
						<HasPermission section={PROXY_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-3">
								<a
									href="/nginx/proxy"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/proxy");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-green text-white avatar">
													<IconBolt />
												</span>
											</div>
											<div className="col">
												<div className="font-weight-medium">
													<T id="proxy-hosts.count" data={{ count: hostReport?.proxy }} />
												</div>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-3">
								<a
									href="/nginx/redirection"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/redirection");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-yellow text-white avatar">
													<IconArrowsCross />
												</span>
											</div>
											<div className="col">
												<T
													id="redirection-hosts.count"
													data={{ count: hostReport?.redirection }}
												/>
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={STREAMS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-3">
								<a
									href="/nginx/stream"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/stream");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-blue text-white avatar">
													<IconDisc />
												</span>
											</div>
											<div className="col">
												<T id="streams.count" data={{ count: hostReport?.stream }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
						<HasPermission section={DEAD_HOSTS} permission={VIEW} hideError>
							<div className="col-sm-6 col-lg-3">
								<a
									href="/nginx/404"
									className="card card-sm card-link card-link-pop"
									onClick={(e) => {
										e.preventDefault();
										navigate("/nginx/404");
									}}
								>
									<div className="card-body">
										<div className="row align-items-center">
											<div className="col-auto">
												<span className="bg-red text-white avatar">
													<IconBoltOff />
												</span>
											</div>
											<div className="col">
												<T id="dead-hosts.count" data={{ count: hostReport?.dead }} />
											</div>
										</div>
									</div>
								</a>
							</div>
						</HasPermission>
					</div>
				</div>
				{canViewHosts ? (
					<div className="col-12">
						<div className="card">
							<div className="card-header">
								<h3 className="card-title">
									<IconActivity size={18} className="me-2 text-blue" />
									<T id="dashboard.status" />
								</h3>
							</div>
							<div className="card-body">
								<div className="row">
									<div className="col-sm-4">
										<div className="text-muted">
											<T id="dashboard.status.online" />
										</div>
										<div className="h3 mb-0">
											{statusLoading ? "..." : statusTotals.online}
										</div>
									</div>
									<div className="col-sm-4">
										<div className="text-muted">
											<T id="dashboard.status.offline" />
										</div>
										<div className="h3 mb-0">
											{statusLoading ? "..." : statusTotals.offline}
										</div>
									</div>
									<div className="col-sm-4">
										<div className="text-muted">
											<T id="dashboard.status.total" />
										</div>
										<div className="h3 mb-0">
											{statusLoading ? "..." : statusTotals.total}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				) : null}
				<div className="col-12">
					<div className="row row-cards">
						<HasPermission section={CERTIFICATES} permission={VIEW} hideError>
							<div className="col-md-6 col-lg-4">
								<div className="card">
									<div className="card-header">
										<h3 className="card-title">
											<IconShield size={18} className="me-2 text-teal" />
											<T id="dashboard.certificates" />
										</h3>
									</div>
									<div className="card-body">
										<div className="row">
											<div className="col-6">
												<div className="text-muted">
													<T id="dashboard.certificates.expiring" />
												</div>
												<div className="h3 mb-0">
													{certificatesQuery.isLoading ? "..." : certStats.expiring}
												</div>
											</div>
											<div className="col-6">
												<div className="text-muted">
													<T id="dashboard.certificates.expired" />
												</div>
												<div className="h3 mb-0">
													{certificatesQuery.isLoading ? "..." : certStats.expired}
												</div>
											</div>
										</div>
									</div>
								</div>
							</div>
						</HasPermission>
						{canViewProxy || canViewStreams ? (
							<div className="col-md-6 col-lg-4">
								<div className="card">
									<div className="card-header">
										<h3 className="card-title">
											<IconActivity size={18} className="me-2 text-lime" />
											<T id="dashboard.heartbeat" />
										</h3>
									</div>
									<div className="card-body">
										{canViewProxy ? (
											<div className="mb-3">
												<div className="text-muted">
													<T id="dashboard.heartbeat.proxy" />
												</div>
												<div className="d-flex gap-3 mt-2">
													<span className="badge bg-lime-lt">
														<T id="host.heartbeat.status.ok" />: {heartbeatCounts.proxy.ok}
													</span>
													<span className="badge bg-danger-lt">
														<T id="host.heartbeat.status.failed" />: {heartbeatCounts.proxy.failed}
													</span>
													{heartbeatCounts.proxy.unsupported ? (
														<span className="badge bg-secondary-lt">
															<T id="host.heartbeat.status.unsupported" />:{" "}
															{heartbeatCounts.proxy.unsupported}
														</span>
													) : null}
												</div>
											</div>
										) : null}
										{canViewStreams ? (
											<div>
												<div className="text-muted">
													<T id="dashboard.heartbeat.streams" />
												</div>
												<div className="d-flex gap-3 mt-2">
													<span className="badge bg-lime-lt">
														<T id="host.heartbeat.status.ok" />: {heartbeatCounts.streams.ok}
													</span>
													<span className="badge bg-danger-lt">
														<T id="host.heartbeat.status.failed" />: {heartbeatCounts.streams.failed}
													</span>
													{heartbeatCounts.streams.unsupported ? (
														<span className="badge bg-secondary-lt">
															<T id="host.heartbeat.status.unsupported" />:{" "}
															{heartbeatCounts.streams.unsupported}
														</span>
													) : null}
												</div>
											</div>
										) : null}
										{proxyHeartbeat.status === "checking" || streamHeartbeatState.status === "checking" ? (
											<div className="text-muted mt-2">
												<T id="logs.updating" />
											</div>
										) : null}
									</div>
								</div>
							</div>
						) : null}
						{canViewAdmin ? (
							<div className="col-md-12 col-lg-4">
								<div className="card">
									<div className="card-header">
										<h3 className="card-title">
											<IconAlertTriangle size={18} className="me-2 text-orange" />
											<T id="dashboard.error-logs" />
										</h3>
										<div className="card-actions">
											<button
												type="button"
												className="btn btn-sm btn-outline-primary"
												onClick={() => navigate("/logs")}
											>
												<T id="dashboard.error-logs.view" />
											</button>
										</div>
									</div>
									<div className="card-body">
										{logsQuery.isLoading ? (
											<div className="text-muted">...</div>
										) : errorLogs.length ? (
											<ul className="list-unstyled mb-0">
												{errorLogs.map((log) => (
													<li key={log.name} className="mb-2">
														<div className="fw-semibold">{log.name}</div>
														<div className="text-muted small">
															<T id="dashboard.error-logs.updated" />{" "}
															{formatDateTime(log.modifiedOn)} · {formatBytes(log.size)}
														</div>
													</li>
												))}
											</ul>
										) : (
											<div className="text-muted">
												<T id="dashboard.error-logs.empty" />
											</div>
										)}
									</div>
								</div>
							</div>
						) : null}
					</div>
				</div>
				<HasPermission section={ADMIN} permission={VIEW} hideError>
					<div className="col-12">
						<div className="card">
							<div className="card-header">
								<h3 className="card-title">
									<IconClock size={18} className="me-2 text-purple" />
									<T id="dashboard.recent-activity" />
								</h3>
							</div>
							<div className="card-body">
								{auditLogsQuery.isLoading ? (
									<div className="text-muted">...</div>
								) : auditEvents.length ? (
									<ul className="list-group list-group-flush">
										{auditEvents.map((event) => (
											<li key={event.id} className="list-group-item">
												<EventFormatter row={event} />
											</li>
										))}
									</ul>
								) : (
									<div className="text-muted">
										<T id="dashboard.recent-activity.empty" />
									</div>
								)}
							</div>
						</div>
					</div>
				</HasPermission>
			</div>
		</div>
	);
};

export default Dashboard;
