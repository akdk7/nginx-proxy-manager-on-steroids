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
	onRefresh?: () => void;
	layout?: "column" | "row";
	label?: ReactNode;
}

const Badge = ({ color, children }: { color: string; children: ReactNode }) => (
	<span className={`badge bg-${color}-lt`}>{children}</span>
);

export function HeartbeatStatusFormatter({
	enabled,
	heartbeat,
	isChecking,
	onRefresh,
	layout = "column",
	label,
}: Props) {
	const checkedAt = heartbeat?.checkedAt ? formatDateTime(heartbeat.checkedAt) : null;
	const latencyMs = Number.isFinite(heartbeat?.latencyMs) ? Math.round(heartbeat?.latencyMs || 0) : null;
	const statusCode = Number.isFinite(heartbeat?.statusCode) ? heartbeat?.statusCode : null;
	const resolvedStatus =
		heartbeat?.status ?? (heartbeat ? (heartbeat.ok ? "ok" : "failed") : undefined);
	const labelContent = label ?? <T id="host.heartbeat" />;

	const badgeContent = (() => {
		if (!enabled) {
			return (
				<Badge color="secondary">
					{labelContent}: <T id="host.heartbeat.status.disabled" />
				</Badge>
			);
		}
		if (isChecking) {
			return (
				<Badge color="yellow">
					{labelContent}: <T id="host.heartbeat.status.checking" />
				</Badge>
			);
		}
		if (!heartbeat) {
			return (
				<Badge color="secondary">
					{labelContent}: <T id="host.heartbeat.status.unknown" />
				</Badge>
			);
		}
		if (resolvedStatus === "unsupported") {
			return (
				<Badge color="secondary">
					{labelContent}: <T id="host.heartbeat.status.unsupported" />
				</Badge>
			);
		}
		if (heartbeat.ok) {
			return (
				<Badge color="lime">
					{labelContent}: <T id="host.heartbeat.status.ok" />
				</Badge>
			);
		}
		return (
			<Badge color="danger">
				{labelContent}: <T id="host.heartbeat.status.failed" />
			</Badge>
		);
	})();

	const clickableBadge = onRefresh ? (
		<button
			type="button"
			className="btn btn-link p-0 text-decoration-none"
			onClick={onRefresh}
		>
			{badgeContent}
		</button>
	) : (
		badgeContent
	);

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
		<div
			className={
				layout === "row"
					? "d-inline-flex align-items-center gap-2 flex-wrap"
					: "d-flex flex-column gap-1"
			}
		>
			<TrueFalseFormatter value={enabled} trueLabel="online" falseLabel="offline" />
			{popover ? (
				<OverlayTrigger trigger={["hover", "click", "focus"]} placement="bottom" overlay={popover}>
					<span>{clickableBadge}</span>
				</OverlayTrigger>
			) : (
				clickableBadge
			)}
		</div>
	);
}
