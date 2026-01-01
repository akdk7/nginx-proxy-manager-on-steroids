import * as api from "./base";
import type { StreamHeartbeatRequest, StreamHeartbeatResult } from "./models";

export async function checkStreamHeartbeats(
	streams: StreamHeartbeatRequest[],
	abortController?: AbortController,
): Promise<StreamHeartbeatResult[]> {
	return await api.post(
		{
			url: "/nginx/streams/heartbeat",
			data: {
				streams,
			},
		},
		abortController,
	);
}
