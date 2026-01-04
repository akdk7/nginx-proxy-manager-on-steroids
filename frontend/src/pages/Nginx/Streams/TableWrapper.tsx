import { IconHelp, IconSearch } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import {
	checkStreamHeartbeats,
	deleteStream,
	toggleStream,
	type Stream,
	type StreamHeartbeatResult,
} from "src/api/backend";
import { Button, HasPermission, LoadingPage } from "src/components";
import { useStreams } from "src/hooks";
import { T } from "src/locale";
import { formatPortRanges } from "src/modules/PortRanges";
import { showDeleteConfirmModal, showHelpModal, showStreamModal } from "src/modals";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";
import Table from "./Table";

const getIncomingPorts = (stream: Stream) =>
	Array.isArray(stream.incomingPorts) && stream.incomingPorts.length
		? stream.incomingPorts
		: Number.isFinite(stream.incomingPort) && stream.incomingPort > 0
			? [stream.incomingPort]
			: [];

const getForwardingPorts = (stream: Stream) =>
	Array.isArray(stream.forwardingPorts) && stream.forwardingPorts.length
		? stream.forwardingPorts
		: Number.isFinite(stream.forwardingPort) && stream.forwardingPort > 0
			? [stream.forwardingPort]
			: [];

export default function TableWrapper() {
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [heartbeats, setHeartbeats] = useState<Record<number, StreamHeartbeatResult>>({});
	const [heartbeatsLoading, setHeartbeatsLoading] = useState(false);
	const [heartbeatRefreshIds, setHeartbeatRefreshIds] = useState<Record<number, boolean>>({});
	const { isFetching, isLoading, isError, error, data } = useStreams(["owner", "certificate"]);

	const getIncomingPortsLabel = (stream: Stream) => formatPortRanges(getIncomingPorts(stream));
	const getForwardingPortsLabel = (stream: Stream) => formatPortRanges(getForwardingPorts(stream));

	const buildDuplicateSeed = (stream: Stream) => {
		const incomingPorts = getIncomingPorts(stream);
		const forwardingPorts = getForwardingPorts(stream);
		return {
			incomingPort: incomingPorts[0] || stream.incomingPort,
			incomingPorts,
			forwardingHost: stream.forwardingHost,
			forwardingPort: forwardingPorts[0] || stream.forwardingPort,
			forwardingPorts,
			upstreamEnabled: stream.upstreamEnabled,
			upstreamPolicy: stream.upstreamPolicy,
			upstreamServers: stream.upstreamServers || [],
			tcpForwarding: stream.tcpForwarding,
			udpForwarding: stream.udpForwarding,
			proxyProtocol: stream.proxyProtocol,
			proxyProtocolUpstream: stream.proxyProtocolUpstream,
			geoAccessOverride: stream.geoAccessOverride,
			geoAccessEnabled: stream.geoAccessEnabled,
			geoAccessMode: stream.geoAccessMode,
			geoAccessPreset: stream.geoAccessPreset,
			geoAccessCountries: Array.isArray(stream.geoAccessCountries) ? stream.geoAccessCountries : [],
			certificateId: stream.certificateId,
			meta: {},
		};
	};

	const heartbeatTargets = useMemo(() => {
		if (!data?.length) {
			return [];
		}
		return data
			.filter((stream) => stream.enabled)
			.map((stream) => {
				const upstream = stream.upstreamEnabled && stream.upstreamServers?.length ? stream.upstreamServers[0] : null;
				const forwardingPort = getForwardingPorts(stream)[0] || stream.forwardingPort;
				return {
					id: stream.id,
					forwardingHost: upstream?.host || stream.forwardingHost,
					forwardingPort: upstream?.port || forwardingPort,
					tcpForwarding: stream.tcpForwarding,
					udpForwarding: stream.udpForwarding,
				};
			});
	}, [data]);

	useEffect(() => {
		if (!heartbeatTargets.length) {
			setHeartbeats({});
			setHeartbeatsLoading(false);
			return;
		}

		let active = true;
		const abortController = new AbortController();
		setHeartbeatsLoading(true);

		checkStreamHeartbeats(heartbeatTargets, abortController)
			.then((results) => {
				if (!active) return;
				const next: Record<number, StreamHeartbeatResult> = {};
				results.forEach((result) => {
					if (typeof result.id === "number") {
						next[result.id] = result;
					}
				});
				setHeartbeats(next);
			})
			.catch(() => {
				if (active) {
					setHeartbeats({});
				}
			})
			.finally(() => {
				if (active) {
					setHeartbeatsLoading(false);
				}
			});

		return () => {
			active = false;
			abortController.abort();
		};
	}, [heartbeatTargets]);

	if (isLoading) {
		return <LoadingPage />;
	}

	if (isError) {
		return <Alert variant="danger">{error?.message || "Unknown error"}</Alert>;
	}

	const handleDelete = async (id: number) => {
		await deleteStream(id);
		showObjectSuccess("stream", "deleted");
	};

	const handleDisableToggle = async (id: number, enabled: boolean) => {
		await toggleStream(id, enabled);
		queryClient.invalidateQueries({ queryKey: ["streams"] });
		queryClient.invalidateQueries({ queryKey: ["stream", id] });
		showObjectSuccess("stream", enabled ? "enabled" : "disabled");
	};

	const handleHeartbeatRefresh = async (id: number) => {
		const stream = data?.find((item) => item.id === id);
		if (!stream) {
			return;
		}
		const upstream =
			stream.upstreamEnabled && stream.upstreamServers?.length ? stream.upstreamServers[0] : null;
		const forwardingPort = getForwardingPorts(stream)[0] || stream.forwardingPort;
		setHeartbeatRefreshIds((prev) => ({ ...prev, [id]: true }));
		try {
			const results = await checkStreamHeartbeats([
				{
					id: stream.id,
					forwardingHost: upstream?.host || stream.forwardingHost,
					forwardingPort: upstream?.port || forwardingPort,
					tcpForwarding: stream.tcpForwarding,
					udpForwarding: stream.udpForwarding,
				},
			]);
			const result = results?.[0];
			if (result) {
				setHeartbeats((prev) => ({
					...prev,
					[id]: result,
				}));
			}
		} finally {
			setHeartbeatRefreshIds((prev) => {
				const next = { ...prev };
				delete next[id];
				return next;
			});
		}
	};

	let filtered = null;
	if (search && data) {
		filtered = data?.filter((item) => {
			const portLabel = getIncomingPortsLabel(item);
			const forwardLabel = getForwardingPortsLabel(item);
			return (
				portLabel.includes(search) ||
				forwardLabel.includes(search) ||
				`${item.forwardingPort}`.includes(search) ||
				item.forwardingHost.includes(search)
			);
		});
	} else if (search !== "") {
		// this can happen if someone deletes the last item while searching
		setSearch("");
	}

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-blue" />
			<div className="card-table">
				<div className="card-header">
					<div className="row w-full">
						<div className="col">
							<h2 className="mt-1 mb-0">
								<T id="streams" />
							</h2>
						</div>
						<div className="col-md-auto col-sm-12">
							<div className="ms-auto d-flex flex-wrap btn-list">
								{data?.length ? (
									<div className="input-group input-group-flat w-auto">
										<span className="input-group-text input-group-text-sm">
											<IconSearch size={16} />
										</span>
										<input
											id="advanced-table-search"
											type="text"
											className="form-control form-control-sm"
											autoComplete="off"
											onChange={(e: any) => setSearch(e.target.value.toLowerCase().trim())}
										/>
									</div>
								) : null}
								<Button size="sm" onClick={() => showHelpModal("Streams", "blue")}>
									<IconHelp size={20} />
								</Button>
								<HasPermission section={STREAMS} permission={MANAGE} hideError>
									{data?.length ? (
										<Button size="sm" className="btn-blue" onClick={() => showStreamModal("new")}>
											<T id="object.add" tData={{ object: "stream" }} />
										</Button>
									) : null}
								</HasPermission>
							</div>
						</div>
					</div>
				</div>
				<Table
					data={filtered ?? data ?? []}
					isFetching={isFetching}
					isFiltered={!!filtered}
					heartbeats={heartbeats}
					heartbeatsLoading={heartbeatsLoading}
					heartbeatRefreshIds={heartbeatRefreshIds}
					onHeartbeatRefresh={handleHeartbeatRefresh}
					onEdit={(id: number) => showStreamModal(id)}
					onDelete={(id: number) =>
						showDeleteConfirmModal({
							title: <T id="object.delete" tData={{ object: "stream" }} />,
							onConfirm: () => handleDelete(id),
							invalidations: [["streams"], ["stream", id]],
							children: <T id="object.delete.content" tData={{ object: "stream" }} />,
						})
					}
					onDisableToggle={handleDisableToggle}
					onDuplicate={(stream: Stream) => showStreamModal("new", buildDuplicateSeed(stream))}
					onNew={() => showStreamModal("new")}
				/>
			</div>
		</div>
	);
}
