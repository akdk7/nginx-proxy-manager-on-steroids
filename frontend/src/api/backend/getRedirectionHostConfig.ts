import * as api from "./base";

export async function getRedirectionHostConfig(id: number): Promise<string> {
	return api.getText({
		url: `/nginx/redirection-hosts/${id}/config`,
	});
}
