import { useMemo, useState } from "react";
import { getLocale, intl, T } from "src/locale";
import { getCountryOptions } from "src/data/countries";
import { Flag } from "./Flag";

type CountryOption = {
	code: string;
	name: string;
};

type CountryChecklistProps = {
	value: string[];
	onChange: (value: string[]) => void;
	disabled?: boolean;
};

const normalizeValue = (value: string[]) =>
	Array.isArray(value)
		? value.map((code) => `${code || ""}`.trim().toUpperCase()).filter(Boolean)
		: [];

export default function CountryChecklist({ value, onChange, disabled = false }: CountryChecklistProps) {
	const [filter, setFilter] = useState("");
	const locale = getLocale(true);
	const options = useMemo<CountryOption[]>(() => getCountryOptions(locale), [locale]);
	const selectedSet = useMemo(() => new Set(normalizeValue(value)), [value]);
	const normalizedFilter = filter.trim().toLowerCase();

	const filteredOptions = useMemo(() => {
		if (!normalizedFilter) {
			return options;
		}
		return options.filter((option) => {
			const haystack = `${option.code} ${option.name}`.toLowerCase();
			return haystack.includes(normalizedFilter);
		});
	}, [normalizedFilter, options]);

	const updateSelection = (nextSet: Set<string>) => {
		const ordered = options
			.filter((option) => nextSet.has(option.code))
			.map((option) => option.code);
		onChange(ordered);
	};

	const toggleCode = (code: string) => {
		if (disabled) {
			return;
		}
		const normalized = `${code || ""}`.trim().toUpperCase();
		const next = new Set(selectedSet);
		if (next.has(normalized)) {
			next.delete(normalized);
		} else {
			next.add(normalized);
		}
		updateSelection(next);
	};

	const selectFiltered = () => {
		if (disabled) {
			return;
		}
		const next = new Set(selectedSet);
		filteredOptions.forEach((option) => next.add(option.code));
		updateSelection(next);
	};

	const clearFiltered = () => {
		if (disabled) {
			return;
		}
		const next = new Set(selectedSet);
		filteredOptions.forEach((option) => next.delete(option.code));
		updateSelection(next);
	};

	return (
		<div>
			<div className="d-flex flex-wrap gap-2 mb-2 align-items-center">
				<input
					type="text"
					className="form-control"
					placeholder={intl.formatMessage({ id: "geo-access.countries.search" })}
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					disabled={disabled}
				/>
				<button type="button" className="btn btn-outline-secondary" onClick={selectFiltered} disabled={disabled}>
					<T id="geo-access.countries.select-all" />
				</button>
				<button type="button" className="btn btn-outline-secondary" onClick={clearFiltered} disabled={disabled}>
					<T id="geo-access.countries.clear" />
				</button>
				<span className="text-muted">
					<T id="geo-access.countries.selected" data={{ count: selectedSet.size, total: options.length }} />
				</span>
			</div>
			<div className="border rounded p-2" style={{ maxHeight: 260, overflow: "auto" }}>
				{filteredOptions.map((option) => {
					const checked = selectedSet.has(option.code);
					return (
						<label key={option.code} className="form-check d-flex align-items-center gap-2 mb-1">
							<input
								className="form-check-input"
								type="checkbox"
								checked={checked}
								onChange={() => toggleCode(option.code)}
								disabled={disabled}
							/>
							<Flag countryCode={option.code} />
							<span>
								{option.name} ({option.code})
							</span>
						</label>
					);
				})}
			</div>
		</div>
	);
}
