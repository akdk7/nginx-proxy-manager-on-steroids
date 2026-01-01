import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import { intl, T } from "src/locale";

interface Props {
	enabled?: boolean;
	rps?: number;
	burst?: number;
	nodelay?: boolean;
}

export function RateLimitFormatter({ enabled, rps, burst, nodelay }: Props) {
	const safeRps = Number.parseInt(`${rps ?? 0}`, 10);
	if (!enabled || !Number.isFinite(safeRps) || safeRps <= 0) {
		return <span className="text-muted"><T id="host.rate-limit.off" /></span>;
	}

	const safeBurst = Number.parseInt(`${burst ?? 0}`, 10);
	const summary = intl.formatMessage({ id: "host.rate-limit.summary" }, { rps: safeRps });
	const popover = (
		<Popover id="rate-limit-popover">
			<Popover.Body>
				<div>
					<strong>
						<T id="host.rate-limit" />
					</strong>
				</div>
				<div className="ms-1">
					<T id="host.rate-limit.rps" />: {safeRps}
				</div>
				{Number.isFinite(safeBurst) && safeBurst > 0 ? (
					<div className="ms-1">
						<T id="host.rate-limit.burst" />: {safeBurst}
					</div>
				) : null}
				<div className="ms-1">
					<T id="host.rate-limit.nodelay" />: <T id={nodelay ? "enabled" : "disabled"} />
				</div>
			</Popover.Body>
		</Popover>
	);

	return (
		<OverlayTrigger trigger={["hover", "click", "focus"]} placement="bottom" overlay={popover}>
			<span className="badge bg-cyan-lt">{summary}</span>
		</OverlayTrigger>
	);
}
