import { IconRefresh } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import Alert from "react-bootstrap/Alert";
import { Button, LoadingPage } from "src/components";
import { useLogFile, useLogs } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";

const minLines = 10;
const maxLines = 5000;
const defaultLines = 200;

const refreshIntervals = [
	{ labelId: "logs.interval.off", value: 0 },
	{ label: "1s", value: 1000 },
	{ label: "2s", value: 2000 },
	{ label: "5s", value: 5000 },
	{ label: "10s", value: 10000 },
];

const LogsView = () => {
	const { isLoading, isError, error, data: logs } = useLogs();
	const [selectedLog, setSelectedLog] = useState<string>("");
	const [lines, setLines] = useState<number>(defaultLines);
	const [refreshMs, setRefreshMs] = useState<number>(0);
	const [filter, setFilter] = useState<string>("");
	const [ignoreCase, setIgnoreCase] = useState<boolean>(false);

	useEffect(() => {
		if (!logs?.length) {
			setSelectedLog("");
			return;
		}
		if (!selectedLog || !logs.some((log) => log.name === selectedLog)) {
			setSelectedLog(logs[0].name);
		}
	}, [logs, selectedLog]);

	const clampedLines = Math.max(minLines, Math.min(maxLines, lines));
	const logQuery = useLogFile(
		selectedLog,
		{ lines: clampedLines },
		{ refetchInterval: refreshMs > 0 ? refreshMs : false },
	);

	const filtered = useMemo(() => {
		const logLines = logQuery.data?.lines ?? [];
		if (!filter.trim()) {
			return { lines: logLines, error: null };
		}
		try {
			const regex = new RegExp(filter, ignoreCase ? "i" : "");
			return { lines: logLines.filter((line) => regex.test(line)), error: null };
		} catch (err) {
			return { lines: logLines, error: err instanceof Error ? err.message : "invalid" };
		}
	}, [filter, ignoreCase, logQuery.data?.lines]);

	if (isLoading) {
		return <LoadingPage />;
	}

	if (isError) {
		return <Alert variant="danger">{error?.message || "Unknown error"}</Alert>;
	}

	const showEmpty = !logs || logs.length === 0;
	const showLogError = logQuery.isError ? (
		<Alert variant="danger">{logQuery.error?.message || "Unknown error"}</Alert>
	) : null;

	return (
		<div className="card mt-4">
			<div className="card-status-top bg-indigo" />
			<div className="card-header">
				<div className="row w-full align-items-center">
					<div className="col">
						<h2 className="mt-1 mb-0">
							<T id="logs" />
						</h2>
						{logQuery.data?.modifiedOn ? (
							<div className="text-muted">
								<T id="logs.updated" />: {formatDateTime(logQuery.data.modifiedOn)}
							</div>
						) : null}
						{logQuery.data?.truncated ? (
							<div className="text-muted">
								<T id="logs.tail" data={{ lines: `${clampedLines}` }} />
							</div>
						) : null}
					</div>
					<div className="col-auto">
						<Button
							actionType="primary"
							size="sm"
							disabled={!selectedLog || logQuery.isFetching}
							onClick={() => logQuery.refetch()}
						>
							<IconRefresh size={16} />
							<span className="ms-1">
								<T id="logs.refresh" />
							</span>
						</Button>
					</div>
				</div>
			</div>
			<div className="card-body">
				{showEmpty ? (
					<Alert variant="warning">
						<T id="logs.empty" />
					</Alert>
				) : (
					<>
						<div className="row g-3 align-items-end">
							<div className="col-md-4">
								<label className="form-label" htmlFor="log-file">
									<T id="logs.file" />
								</label>
								<select
									id="log-file"
									className="form-select"
									value={selectedLog}
									onChange={(event) => setSelectedLog(event.target.value)}
								>
									{logs?.map((log) => (
										<option key={log.name} value={log.name}>
											{log.name}
										</option>
									))}
								</select>
							</div>
							<div className="col-md-2">
								<label className="form-label" htmlFor="log-lines">
									<T id="logs.lines" />
								</label>
								<input
									id="log-lines"
									type="number"
									min={minLines}
									max={maxLines}
									className="form-control"
									value={clampedLines}
									onChange={(event) => {
										const next = Number.parseInt(event.target.value, 10);
										if (!Number.isFinite(next)) {
											setLines(defaultLines);
											return;
										}
										setLines(Math.max(minLines, Math.min(maxLines, next)));
									}}
								/>
							</div>
							<div className="col-md-3">
								<label className="form-label" htmlFor="log-interval">
									<T id="logs.interval" />
								</label>
								<select
									id="log-interval"
									className="form-select"
									value={refreshMs}
									onChange={(event) => setRefreshMs(Number.parseInt(event.target.value, 10) || 0)}
								>
									{refreshIntervals.map((option) => (
										<option key={option.value} value={option.value}>
											{option.labelId ? intl.formatMessage({ id: option.labelId }) : option.label}
										</option>
									))}
								</select>
							</div>
							<div className="col-md-3">
								<label className="form-label" htmlFor="log-filter">
									<T id="logs.filter" />
								</label>
								<input
									id="log-filter"
									type="text"
									className={`form-control ${filtered.error ? "is-invalid" : ""}`}
									placeholder={intl.formatMessage({ id: "logs.filter.placeholder" })}
									value={filter}
									onChange={(event) => setFilter(event.target.value)}
								/>
								{filtered.error ? (
									<div className="invalid-feedback">
										<T id="logs.regex.invalid" />
									</div>
								) : null}
								<label className="form-check mt-2">
									<input
										type="checkbox"
										className="form-check-input"
										checked={ignoreCase}
										onChange={(event) => setIgnoreCase(event.target.checked)}
									/>
									<span className="form-check-label">
										<T id="logs.filter.ignore-case" />
									</span>
								</label>
							</div>
						</div>
						{showLogError}
						<div className="mt-3">
							{logQuery.isFetching ? (
								<div className="text-muted mb-2">
									<T id="logs.updating" />
								</div>
							) : null}
							{filtered.lines.length ? (
								<pre className="bg-dark text-light p-3 rounded overflow-auto">
									{filtered.lines.join("\n")}
								</pre>
							) : (
								<Alert variant="secondary" className="mb-0">
									<T id="logs.no-content" />
								</Alert>
							)}
						</div>
					</>
				)}
			</div>
		</div>
	);
};

export default LogsView;
