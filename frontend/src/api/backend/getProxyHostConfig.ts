import * as api from "./base";

export async function getProxyHostConfig(id: number): Promise<string> {
	return api.getText({
		url: `/nginx/proxy-hosts/${id}/config`,
	});
}
