import * as api from "./base";
import type { ProxyHostHeartbeatRequest, ProxyHostHeartbeatResult } from "./models";

export async function checkProxyHostHeartbeats(
	hosts: ProxyHostHeartbeatRequest[],
	abortController?: AbortController,
): Promise<ProxyHostHeartbeatResult[]> {
	return await api.post(
		{
			url: "/nginx/proxy-hosts/heartbeat",
			data: {
				hosts,
			},
		},
		abortController,
	);
}
