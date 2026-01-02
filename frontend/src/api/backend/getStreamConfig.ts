import * as api from "./base";

export async function getStreamConfig(id: number): Promise<string> {
	return api.getText({
		url: `/nginx/streams/${id}/config`,
	});
}
