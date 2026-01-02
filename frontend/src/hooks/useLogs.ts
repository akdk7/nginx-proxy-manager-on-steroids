import { useQuery } from "@tanstack/react-query";
import { getLogs, type LogFile } from "src/api/backend";

const fetchLogs = () => {
	return getLogs();
};

const useLogs = (options = {}) => {
	return useQuery<LogFile[], Error>({
		queryKey: ["logs"],
		queryFn: fetchLogs,
		staleTime: 10 * 1000,
		...options,
	});
};

export { fetchLogs, useLogs };
