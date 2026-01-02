import express from "express";
import internalLogs from "../internal/logs.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";
import { debug, express as logger } from "../logger.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/logs
 */
router
	.route("/")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/logs
	 *
	 * Retrieve available log files
	 */
	.get(async (req, res, next) => {
		try {
			const rows = await internalLogs.list(res.locals.access);
			res.status(200).send(rows);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

/**
 * Specific log file
 *
 * /api/logs/error.log
 */
router
	.route("/:log_name")
	.options((_, res) => {
		res.sendStatus(204);
	})
	.all(jwtdecode())

	/**
	 * GET /api/logs/error.log
	 *
	 * Retrieve log file contents
	 */
	.get(async (req, res, next) => {
		try {
			const data = await validator(
				{
					required: ["log_name"],
					additionalProperties: false,
					properties: {
						log_name: {
							type: "string",
							minLength: 1,
							maxLength: 255,
						},
						lines: {
							type: "integer",
							minimum: 1,
							maximum: 5000,
						},
						max_bytes: {
							type: "integer",
							minimum: 1024,
							maximum: 5242880,
						},
					},
				},
				{
					log_name: req.params.log_name,
					lines: req.query.lines,
					max_bytes: req.query.max_bytes,
				},
			);
			const item = await internalLogs.read(res.locals.access, {
				name: data.log_name,
				lines: data.lines,
				maxBytes: data.max_bytes,
			});
			res.status(200).send(item);
		} catch (err) {
			debug(logger, `${req.method.toUpperCase()} ${req.path}: ${err}`);
			next(err);
		}
	});

export default router;
