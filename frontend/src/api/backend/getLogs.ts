import { get } from "./base";
import type { LogFile } from "./models";

export async function getLogs(): Promise<LogFile[]> {
	return get({ url: "/logs" });
}
