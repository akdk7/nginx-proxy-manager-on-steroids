import type { SecurityHeader } from "src/api/backend";
import { T } from "src/locale";

interface Props {
	headers?: SecurityHeader[];
	onChange: (headers: SecurityHeader[]) => void;
	prefix?: string;
}

const presets: Record<string, SecurityHeader[]> = {
	basic: [
		{ name: "X-Content-Type-Options", value: "nosniff" },
		{ name: "X-Frame-Options", value: "SAMEORIGIN" },
		{ name: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
	],
	strict: [
		{
			name: "Content-Security-Policy",
			value: "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; object-src 'none'",
		},
	],
	hsts: [
		{
			name: "Strict-Transport-Security",
			value: "max-age=63072000; includeSubDomains; preload",
		},
	],
};

const mergeHeaders = (existing: SecurityHeader[], incoming: SecurityHeader[]) => {
	const next = [...existing.map((header) => ({ ...header }))];
	incoming.forEach((incomingHeader) => {
		const key = incomingHeader.name.toLowerCase();
		const idx = next.findIndex((header) => header.name.toLowerCase() === key);
		if (idx >= 0) {
			next[idx] = { ...incomingHeader };
		} else {
			next.push({ ...incomingHeader });
		}
	});
	return next;
};

export function SecurityHeadersFields({ headers, onChange, prefix = "security-headers" }: Props) {
	const values = Array.isArray(headers) ? headers : [];

	const handleAdd = () => {
		onChange([...values, { name: "", value: "" }]);
	};

	const handleRemove = (idx: number) => {
		onChange(values.filter((_, i) => i !== idx));
	};

	const handleChange = (idx: number, field: "name" | "value", value: string) => {
		const next = values.map((header, i) => (i === idx ? { ...header, [field]: value } : header));
		onChange(next);
	};

	const applyPreset = (presetKey: keyof typeof presets) => {
		onChange(mergeHeaders(values, presets[presetKey]));
	};

	return (
		<div>
			<div className="d-flex flex-wrap gap-2 mb-3">
				<button type="button" className="btn btn-sm" onClick={() => applyPreset("basic")}>
					<T id="host.headers.preset.basic" />
				</button>
				<button type="button" className="btn btn-sm" onClick={() => applyPreset("strict")}>
					<T id="host.headers.preset.strict" />
				</button>
				<button type="button" className="btn btn-sm" onClick={() => applyPreset("hsts")}>
					<T id="host.headers.preset.hsts" />
				</button>
			</div>
			{values.length ? (
				values.map((header, idx) => (
					<div key={`${prefix}-${idx}`} className="row g-2 align-items-center mb-2">
						<div className="col-md-4">
							<input
								type="text"
								className="form-control"
								placeholder="Header"
								value={header.name}
								onChange={(e) => handleChange(idx, "name", e.target.value)}
								aria-label="Header Name"
								id={`${prefix}-name-${idx}`}
							/>
						</div>
						<div className="col-md-7">
							<input
								type="text"
								className="form-control"
								placeholder="Value"
								value={header.value}
								onChange={(e) => handleChange(idx, "value", e.target.value)}
								aria-label="Header Value"
								id={`${prefix}-value-${idx}`}
							/>
						</div>
						<div className="col-md-1 text-end">
							<button type="button" className="btn btn-sm" onClick={() => handleRemove(idx)}>
								<T id="action.delete" />
							</button>
						</div>
					</div>
				))
			) : (
				<div className="text-muted small mb-2">
					<T id="host.headers.empty" />
				</div>
			)}
			<button type="button" className="btn btn-sm" onClick={handleAdd}>
				<T id="host.headers.add" />
			</button>
		</div>
	);
}
