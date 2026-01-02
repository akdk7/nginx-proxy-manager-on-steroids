import { get } from "./base";
import type { LogFileContent } from "./models";

interface LogFileParams {
	lines?: number;
	maxBytes?: number;
}

export async function getLogFile(name: string, params?: LogFileParams): Promise<LogFileContent> {
	const encodedName = encodeURIComponent(name);
	return get({ url: `/logs/${encodedName}`, params });
}
