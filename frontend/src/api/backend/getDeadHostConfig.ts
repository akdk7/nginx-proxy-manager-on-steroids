import * as api from "./base";

export async function getDeadHostConfig(id: number): Promise<string> {
	return api.getText({
		url: `/nginx/dead-hosts/${id}/config`,
	});
}
