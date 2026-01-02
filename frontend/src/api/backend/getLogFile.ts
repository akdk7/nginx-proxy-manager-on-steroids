import type { StringifiableRecord } from "query-string";
import { get } from "./base";
import type { LogFileContent } from "./models";

export interface LogFileParams extends StringifiableRecord {
	lines?: number;
	maxBytes?: number;
}

export async function getLogFile(name: string, params?: LogFileParams): Promise<LogFileContent> {
	const encodedName = encodeURIComponent(name);
	return get({ url: `/logs/${encodedName}`, params });
}
