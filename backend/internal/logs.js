import fs from "node:fs/promises";
import path from "node:path";
import errs from "../lib/error.js";

const LOGS_DIR = process.env.NPM_LOGS_DIR || "/data/logs";
const logNamePattern = /\.log(\.\d+)?$/;
const defaultLines = 200;
const maxLines = 5000;
const defaultMaxBytes = 1024 * 1024;
const maxAllowedBytes = 5 * 1024 * 1024;

const normalizeLogName = (name) => {
	if (typeof name !== "string" || !name.trim()) {
		throw new errs.ValidationError("Log file is required");
	}
	const trimmed = name.trim();
	const base = path.basename(trimmed);
	if (base !== trimmed || !logNamePattern.test(base)) {
		throw new errs.ValidationError("Invalid log file");
	}
	return base;
};

const resolveLogPath = (name) => {
	const base = normalizeLogName(name);
	const resolvedDir = path.resolve(LOGS_DIR);
	const resolvedPath = path.resolve(resolvedDir, base);
	if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) {
		throw new errs.ValidationError("Invalid log file");
	}
	return resolvedPath;
};

const clampNumber = (value, min, max, fallback) => {
	if (!Number.isFinite(value)) return fallback;
	return Math.max(min, Math.min(max, value));
};

const readLogTail = async (filePath, lines, maxBytes) => {
	const stats = await fs.stat(filePath);
	if (!stats.isFile()) {
		throw new errs.ItemNotFoundError(path.basename(filePath));
	}
	const size = stats.size;
	if (size === 0) {
			return {
				lines: [],
				size,
				modified_on: stats.mtime.toISOString(),
				truncated: false,
			};
	}

	const readBytes = Math.min(size, maxBytes);
	const start = Math.max(0, size - readBytes);
	const handle = await fs.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(readBytes);
		await handle.read(buffer, 0, readBytes, start);
		let chunkLines = buffer.toString("utf8").split(/\r?\n/);
		if (start > 0 && chunkLines.length) {
			chunkLines = chunkLines.slice(1);
		}
		if (chunkLines.length && chunkLines[chunkLines.length - 1] === "") {
			chunkLines.pop();
		}
		let truncated = start > 0;
		if (chunkLines.length > lines) {
			chunkLines = chunkLines.slice(chunkLines.length - lines);
			truncated = true;
		}
		return {
			lines: chunkLines,
			size,
			modified_on: stats.mtime.toISOString(),
			truncated,
		};
	} finally {
		await handle.close();
	}
};

const internalLogs = {
	list: async (access) => {
		await access.can("logs:list");
		let entries;
		try {
			entries = await fs.readdir(LOGS_DIR, { withFileTypes: true });
		} catch (err) {
			if (err?.code === "ENOENT") {
				return [];
			}
			throw err;
		}

		const files = entries
			.filter((entry) => entry.isFile() && logNamePattern.test(entry.name))
			.map(async (entry) => {
				const fullPath = path.join(LOGS_DIR, entry.name);
				const stats = await fs.stat(fullPath);
				return {
					name: entry.name,
					size: stats.size,
					modified_on: stats.mtime.toISOString(),
				};
			});

		const logs = await Promise.all(files);
		return logs.sort((a, b) => a.name.localeCompare(b.name));
	},

	read: async (access, data) => {
		await access.can("logs:get");
		const filePath = resolveLogPath(data.name);
		const lines = clampNumber(data.lines, 10, maxLines, defaultLines);
		const maxBytes = clampNumber(data.maxBytes, 1024, maxAllowedBytes, defaultMaxBytes);

		try {
			const result = await readLogTail(filePath, lines, maxBytes);
			return {
				name: path.basename(filePath),
				...result,
			};
		} catch (err) {
			if (err?.code === "ENOENT") {
				throw new errs.ItemNotFoundError(data.name);
			}
			throw err;
		}
	},
};

export default internalLogs;
