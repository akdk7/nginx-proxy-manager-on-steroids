import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import type { ReactNode } from "react";
import type { HeartbeatResult } from "src/api/backend";
import { formatDateTime, T } from "src/locale";
import { TrueFalseFormatter } from "./TrueFalseFormatter";

interface Props {
	enabled: boolean;
	heartbeat?: HeartbeatResult;
	isChecking?: boolean;
}

const Badge = ({ color, children }: { color: string; children: ReactNode }) => (
	<span className={`badge bg-${color}-lt`}>{children}</span>
);

export function HeartbeatStatusFormatter({ enabled, heartbeat, isChecking }: Props) {
	const checkedAt = heartbeat?.checkedAt ? formatDateTime(heartbeat.checkedAt) : null;
	const latencyMs = Number.isFinite(heartbeat?.latencyMs) ? Math.round(heartbeat?.latencyMs || 0) : null;
	const statusCode = Number.isFinite(heartbeat?.statusCode) ? heartbeat?.statusCode : null;
	const resolvedStatus =
		heartbeat?.status ?? (heartbeat ? (heartbeat.ok ? "ok" : "failed") : undefined);

	const badgeContent = (() => {
		if (!enabled) {
			return (
				<Badge color="secondary">
					<T id="host.heartbeat" />: <T id="host.heartbeat.status.disabled" />
				</Badge>
			);
		}
		if (isChecking && !heartbeat) {
			return (
				<Badge color="yellow">
					<T id="host.heartbeat" />: <T id="host.heartbeat.status.checking" />
				</Badge>
			);
		}
		if (!heartbeat) {
			return (
				<Badge color="secondary">
					<T id="host.heartbeat" />: <T id="host.heartbeat.status.unknown" />
				</Badge>
			);
		}
		if (resolvedStatus === "unsupported") {
			return (
				<Badge color="secondary">
					<T id="host.heartbeat" />: <T id="host.heartbeat.status.unsupported" />
				</Badge>
			);
		}
		if (heartbeat.ok) {
			return (
				<Badge color="lime">
					<T id="host.heartbeat" />: <T id="host.heartbeat.status.ok" />
				</Badge>
			);
		}
		return (
			<Badge color="danger">
				<T id="host.heartbeat" />: <T id="host.heartbeat.status.failed" />
			</Badge>
		);
	})();

	const popover =
		heartbeat ?
			(
				<Popover id="heartbeat-popover">
					<Popover.Body>
						<div>
							<strong>
								<T id="host.heartbeat" />
							</strong>
						</div>
						<div className="ms-1">
							<T id="host.heartbeat.detail.status" />:{" "}
							<T
								id={
									resolvedStatus === "unsupported"
										? "host.heartbeat.status.unsupported"
										: heartbeat.ok
											? "host.heartbeat.status.ok"
											: "host.heartbeat.status.failed"
								}
							/>
						</div>
						{statusCode ? (
							<div className="ms-1">
								<T id="host.heartbeat.detail.status-code" />: {statusCode}
							</div>
						) : null}
						{heartbeat.redirectedToScheme ? (
							<div className="ms-1">
								<T
									id="host.heartbeat.detail.redirect"
									tData={{ scheme: heartbeat.redirectedToScheme }}
								/>
							</div>
						) : null}
						{latencyMs !== null ? (
							<div className="ms-1">
								<T id="host.heartbeat.detail.latency" />: {latencyMs}ms
							</div>
						) : null}
						{checkedAt ? (
							<div className="ms-1">
								<T id="host.heartbeat.detail.checked-at" />: {checkedAt}
							</div>
						) : null}
						{!heartbeat.ok && heartbeat.error ? (
							<div className="ms-1 text-break">
								<T id="host.heartbeat.detail.error" />: {heartbeat.error}
							</div>
						) : null}
					</Popover.Body>
				</Popover>
			)
		: null;

	return (
		<div className="d-flex flex-column gap-1">
			<TrueFalseFormatter value={enabled} trueLabel="online" falseLabel="offline" />
			{popover ? (
				<OverlayTrigger trigger={["hover", "click", "focus"]} placement="bottom" overlay={popover}>
					<span>{badgeContent}</span>
				</OverlayTrigger>
			) : (
				badgeContent
			)}
		</div>
	);
}
