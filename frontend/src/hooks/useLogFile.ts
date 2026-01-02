import { useQuery } from "@tanstack/react-query";
import { getLogFile, type LogFileContent, type LogFileParams } from "src/api/backend";

const fetchLogFile = (name: string, params?: LogFileParams) => {
	return getLogFile(name, params);
};

const useLogFile = (name?: string, params?: LogFileParams, options = {}) => {
	return useQuery<LogFileContent, Error>({
		queryKey: ["log-file", name, params],
		queryFn: () => fetchLogFile(name as string, params),
		enabled: !!name,
		...options,
	});
};

export { fetchLogFile, useLogFile };
