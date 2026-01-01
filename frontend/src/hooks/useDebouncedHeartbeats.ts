import { useEffect, useRef, useState } from "react";
import { checkProxyHostHeartbeats, type ProxyHostHeartbeatResult } from "src/api/backend";

export const heartbeatDebounceMs = 500;

export type HeartbeatTarget = {
	id?: number;
	forwardScheme: string;
	forwardHost: string;
	forwardPort: number;
};

export type HeartbeatState = {
	status: "idle" | "checking" | "success" | "error";
	results: ProxyHostHeartbeatResult[];
	error?: string;
};

export const useDebouncedHeartbeats = (targets: HeartbeatTarget[], refreshKey: number) => {
	const [state, setState] = useState<HeartbeatState>({ status: "idle", results: [] });
	const requestId = useRef(0);

	useEffect(() => {
		// refreshKey exists to force a re-check even if targets are unchanged.
		void refreshKey;
		if (!targets.length) {
			setState({ status: "idle", results: [], error: undefined });
			return;
		}

		const currentRequest = ++requestId.current;
		const abortController = new AbortController();
		setState({ status: "checking", results: [], error: undefined });

		const timer = setTimeout(() => {
			checkProxyHostHeartbeats(targets, abortController)
				.then((results) => {
					if (requestId.current !== currentRequest) return;
					setState({ status: "success", results, error: undefined });
				})
				.catch((err: Error) => {
					if (requestId.current !== currentRequest) return;
					setState({ status: "error", results: [], error: err.message });
				});
		}, heartbeatDebounceMs);

		return () => {
			clearTimeout(timer);
			abortController.abort();
		};
	}, [targets, refreshKey]);

	return state;
};
