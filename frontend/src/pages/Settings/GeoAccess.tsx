import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { updateProxyHost, updateStream } from "src/api/backend";
import { Button, CountryChecklist, Loading } from "src/components";
import { fetchProxyHosts, fetchStreams, useSetSetting, useSetting } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showError, showObjectSuccess, showSuccess } from "src/notifications";

type GeoPreset = {
	id: string;
	name: string;
	mode: "allow" | "deny";
	countries: string[];
};

const createPresetId = () => {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `preset_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

export default function GeoAccess() {
	const { data, isLoading, error } = useSetting("geo-access");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [presetDraft, setPresetDraft] = useState<GeoPreset | null>(null);
	const [presetError, setPresetError] = useState<string | null>(null);
	const [applyPresetId, setApplyPresetId] = useState("");
	const [applyError, setApplyError] = useState<ReactNode | null>(null);
	const [applyTarget, setApplyTarget] = useState<"proxy-hosts" | "streams" | null>(null);
	const geoStatus = data?.meta?.status;
	const checkedAt = geoStatus?.checked_at ? formatDateTime(geoStatus.checked_at) : null;

	const resolveModuleStatus = (moduleStatus: any) => {
		if (!moduleStatus) {
			return "unknown";
		}
		if (!moduleStatus.present) {
			return "missing";
		}
		if (!moduleStatus.configured) {
			return "not-loaded";
		}
		return "ok";
	};

	const resolveDbStatus = (dbStatus: any) => {
		if (!dbStatus) {
			return "unknown";
		}
		if (!dbStatus.exists) {
			return "missing";
		}
		if (!dbStatus.valid) {
			return "invalid";
		}
		return "ok";
	};

	const renderStatusBadge = (state: string) => {
		const colors: Record<string, string> = {
			ok: "bg-success",
			missing: "bg-danger",
			invalid: "bg-danger",
			"not-loaded": "bg-warning",
			unknown: "bg-secondary",
		};
		const color = colors[state] || "bg-secondary";
		return (
			<span className={`badge ${color}`}>
				<T id={`settings.geo-access.status.${state}`} />
			</span>
		);
	};

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: "geo-access",
			value: "geo-access",
			meta: {
				http_enabled: !!values.httpEnabled,
				stream_enabled: !!values.streamEnabled,
				db_path: `${values.dbPath || ""}`.trim(),
				mode: values.mode || "allow",
				countries: Array.isArray(values.countries) ? values.countries : [],
				presets: Array.isArray(values.presets) ? values.presets : [],
			},
		};

		setSetting(payload, {
			onError: (err: any) => setErrorMsg(<T id={err.message} />),
			onSuccess: () => {
				showObjectSuccess("setting", "saved");
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	const validate = (values: any) => {
		const errors: Record<string, any> = {};
		const enabled = !!values.httpEnabled || !!values.streamEnabled;
		const dbPath = `${values.dbPath || ""}`.trim();
		const countries = Array.isArray(values.countries) ? values.countries : [];
		if (enabled && !dbPath) {
			errors.dbPath = intl.formatMessage({ id: "error.required" });
		}
		if (enabled && (values.mode || "allow") === "allow" && countries.length === 0) {
			errors.countries = intl.formatMessage({ id: "error.geo-access.countries-required" });
		}
		return errors;
	};

	const applyPreset = async (target: "proxy-hosts" | "streams", values: any) => {
		if (applyTarget) {
			return;
		}
		const presets = Array.isArray(values.presets) ? values.presets : [];
		const preset = presets.find((entry: GeoPreset) => entry.id === applyPresetId);
		if (!preset) {
			setApplyError(<T id="settings.geo-access.presets.apply.error" />);
			return;
		}
		setApplyTarget(target);
		setApplyError(null);
		try {
			const items =
				target === "proxy-hosts" ? await fetchProxyHosts() : await fetchStreams();
			for (const item of items) {
				const payload = {
					id: item.id,
					geoAccessOverride: true,
					geoAccessEnabled: true,
					geoAccessPreset: preset.id,
					geoAccessMode: preset.mode,
					geoAccessCountries: preset.countries,
				};
				if (target === "proxy-hosts") {
					await updateProxyHost(payload as any);
				} else {
					await updateStream(payload as any);
				}
			}
			showSuccess(
				intl.formatMessage(
					{ id: "settings.geo-access.presets.apply.success" },
					{
						preset: preset.name,
						count: items.length,
						target: intl.formatMessage({ id: target }),
					},
				),
			);
		} catch (err: any) {
			const message = typeof err?.message === "string" ? err.message : "Unexpected error";
			showError(message);
			setApplyError(message);
		} finally {
			setApplyTarget(null);
		}
	};

	if (!isLoading && error) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Alert variant="danger" show>
						{error.message}
					</Alert>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="card-body">
				<div className="mb-3">
					<Loading noLogo />
				</div>
			</div>
		);
	}

	return (
		<Formik
			enableReinitialize
			initialValues={
				{
					httpEnabled: data?.meta?.http_enabled ?? data?.meta?.httpEnabled ?? false,
					streamEnabled: data?.meta?.stream_enabled ?? data?.meta?.streamEnabled ?? false,
					dbPath:
						data?.meta?.db_path ??
						data?.meta?.dbPath ??
						"/data/GeoLite2-Country.mmdb",
					mode: data?.meta?.mode || "allow",
					countries: Array.isArray(data?.meta?.countries) ? data.meta.countries : [],
					presets: Array.isArray(data?.meta?.presets) ? data.meta.presets : [],
				} as any
			}
			validate={validate}
			onSubmit={onSubmit}
		>
			{({ values, errors, submitCount, setFieldValue }) => (
				<Form>
					<div className="card-body">
						<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
							{errorMsg}
						</Alert>
						<div className="mb-4">
							<h3 className="mb-1">
								<T id="settings.geo-access" />
							</h3>
							<div className="text-muted">
								<T id="settings.geo-access.description" />
							</div>
							<Alert variant="warning" className="mt-3">
								<T id="settings.geo-access.notice" />
							</Alert>
						</div>
						{geoStatus ? (
							<div className="mb-4">
								<h4 className="mb-2">
									<T id="settings.geo-access.status.title" />
								</h4>
								{checkedAt ? (
									<div className="text-muted small mb-3">
										<T id="settings.geo-access.status.checked" data={{ date: checkedAt }} />
									</div>
								) : null}
								<div className="row g-3">
									<div className="col-md-4">
										<div className="d-flex align-items-center justify-content-between">
											<span className="fw-semibold">
												<T id="settings.geo-access.status.http-module" />
											</span>
											{renderStatusBadge(resolveModuleStatus(geoStatus.modules?.http))}
										</div>
										{geoStatus.modules?.http?.path ? (
											<div className="text-muted small">
												<T
													id="settings.geo-access.status.path"
													data={{ path: geoStatus.modules.http.path }}
												/>
											</div>
										) : null}
									</div>
									<div className="col-md-4">
										<div className="d-flex align-items-center justify-content-between">
											<span className="fw-semibold">
												<T id="settings.geo-access.status.stream-module" />
											</span>
											{renderStatusBadge(resolveModuleStatus(geoStatus.modules?.stream))}
										</div>
										{geoStatus.modules?.stream?.path ? (
											<div className="text-muted small">
												<T
													id="settings.geo-access.status.path"
													data={{ path: geoStatus.modules.stream.path }}
												/>
											</div>
										) : null}
									</div>
									<div className="col-md-4">
										<div className="d-flex align-items-center justify-content-between">
											<span className="fw-semibold">
												<T id="settings.geo-access.status.database" />
											</span>
											{renderStatusBadge(resolveDbStatus(geoStatus.database))}
										</div>
										{geoStatus.database?.path ? (
											<div className="text-muted small">
												<T
													id="settings.geo-access.status.path"
													data={{ path: geoStatus.database.path }}
												/>
											</div>
										) : null}
									</div>
								</div>
							</div>
						) : null}
						<div className="row mb-3">
							<div className="col-md-6">
								<label className="form-label" htmlFor="geoAccessHttpEnabled">
									<T id="settings.geo-access.http" />
								</label>
								<div>
									<Field name="httpEnabled" type="checkbox">
										{({ field }: any) => (
											<label className="form-check form-check-single form-switch">
												<input
													id="geoAccessHttpEnabled"
													className="form-check-input"
													type="checkbox"
													name={field.name}
													checked={field.value}
													onChange={(e) => setFieldValue(field.name, e.target.checked)}
												/>
											</label>
										)}
									</Field>
								</div>
							</div>
							<div className="col-md-6">
								<label className="form-label" htmlFor="geoAccessStreamEnabled">
									<T id="settings.geo-access.stream" />
								</label>
								<div>
									<Field name="streamEnabled" type="checkbox">
										{({ field }: any) => (
											<label className="form-check form-check-single form-switch">
												<input
													id="geoAccessStreamEnabled"
													className="form-check-input"
													type="checkbox"
													name={field.name}
													checked={field.value}
													onChange={(e) => setFieldValue(field.name, e.target.checked)}
												/>
											</label>
										)}
									</Field>
								</div>
							</div>
						</div>
						<div className="row mb-3">
							<div className="col-md-6">
								<Field name="dbPath">
									{({ field, form }: any) => (
										<div>
											<label className="form-label" htmlFor="geoAccessDbPath">
												<T id="settings.geo-access.db-path" />
											</label>
											<input
												{...field}
												id="geoAccessDbPath"
												type="text"
												className={`form-control ${
													form.errors.dbPath && submitCount > 0 ? "is-invalid" : ""
												}`}
												placeholder="/data/GeoLite2-Country.mmdb"
											/>
											{form.errors.dbPath && submitCount > 0 ? (
												<div className="invalid-feedback d-block">{form.errors.dbPath}</div>
											) : null}
										</div>
									)}
								</Field>
							</div>
							<div className="col-md-6">
								<label className="form-label" htmlFor="geoAccessMode">
									<T id="settings.geo-access.mode" />
								</label>
								<select
									id="geoAccessMode"
									className="form-control"
									value={values.mode || "allow"}
									onChange={(e) => {
										const next = e.target.value;
										setFieldValue("mode", next);
									}}
								>
									<option value="allow">
										<T id="settings.geo-access.mode.allow" />
									</option>
									<option value="deny">
										<T id="settings.geo-access.mode.deny" />
									</option>
								</select>
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="geoAccessCountries">
								<T id="settings.geo-access.countries" />
							</label>
							<CountryChecklist
								inputId="geoAccessCountries"
								value={values.countries || []}
								onChange={(next) => setFieldValue("countries", next)}
							/>
							{typeof errors.countries === "string" && submitCount > 0 ? (
								<div className="text-danger small mt-2">{errors.countries}</div>
							) : null}
						</div>
						<div className="mb-4">
							<h4 className="mb-2">
								<T id="settings.geo-access.presets" />
							</h4>
							<div className="text-muted mb-3">
								<T id="settings.geo-access.presets.description" />
							</div>
							{presetDraft ? (
								<div className="border rounded p-3 mb-3">
									<div className="row mb-3">
										<div className="col-md-6">
											<label className="form-label" htmlFor="geoAccessPresetName">
												<T id="settings.geo-access.presets.name" />
											</label>
											<input
												id="geoAccessPresetName"
												type="text"
												className="form-control"
												value={presetDraft.name}
												onChange={(e) => {
													setPresetDraft({ ...presetDraft, name: e.target.value });
													setPresetError(null);
												}}
											/>
										</div>
										<div className="col-md-6">
											<label className="form-label" htmlFor="geoAccessPresetMode">
												<T id="settings.geo-access.presets.mode" />
											</label>
											<select
												id="geoAccessPresetMode"
												className="form-control"
												value={presetDraft.mode}
												onChange={(e) => {
													setPresetDraft({
														...presetDraft,
														mode: e.target.value as GeoPreset["mode"],
													});
													setPresetError(null);
												}}
											>
												<option value="allow">
													<T id="settings.geo-access.mode.allow" />
												</option>
												<option value="deny">
													<T id="settings.geo-access.mode.deny" />
												</option>
											</select>
										</div>
									</div>
									<div className="mb-3">
										<label className="form-label" htmlFor="geoAccessPresetCountries">
											<T id="settings.geo-access.countries" />
										</label>
										<CountryChecklist
											inputId="geoAccessPresetCountries"
											value={presetDraft.countries || []}
											onChange={(next) => {
												setPresetDraft({ ...presetDraft, countries: next });
												setPresetError(null);
											}}
										/>
									</div>
									{presetError ? (
										<div className="text-danger small mb-2">
											<T id={presetError} />
										</div>
									) : null}
									<div className="btn-list">
										<Button
											actionType="primary"
											onClick={() => {
												const name = presetDraft.name.trim();
												if (!name) {
													setPresetError("error.required");
													return;
												}
												if (
													presetDraft.mode === "allow" &&
													presetDraft.countries.length === 0
												) {
													setPresetError("error.geo-access.countries-required");
													return;
												}
												const nextPresets = Array.isArray(values.presets)
													? [...values.presets]
													: [];
												const existingIndex = nextPresets.findIndex(
													(preset: GeoPreset) => preset.id === presetDraft.id,
												);
												const entry = {
													...presetDraft,
													name,
												};
												if (existingIndex >= 0) {
													nextPresets[existingIndex] = entry;
												} else {
													nextPresets.push(entry);
												}
												setFieldValue("presets", nextPresets);
												setPresetDraft(null);
												setPresetError(null);
											}}
										>
											<T id="settings.geo-access.presets.save" />
										</Button>
										<Button
											className="btn-outline-secondary"
											onClick={() => {
												setPresetDraft(null);
												setPresetError(null);
											}}
										>
											<T id="settings.geo-access.presets.cancel" />
										</Button>
									</div>
								</div>
							) : (
								<Button
									className="btn-outline-primary"
									onClick={() => {
										setPresetDraft({
											id: createPresetId(),
											name: "",
											mode: "allow",
											countries: [],
										});
										setPresetError(null);
									}}
								>
									<T id="settings.geo-access.presets.add" />
								</Button>
							)}
							{Array.isArray(values.presets) && values.presets.length > 0 ? (
								<div className="table-responsive mt-3">
									<table className="table table-vcenter">
										<thead>
											<tr>
												<th>
													<T id="settings.geo-access.presets.name" />
												</th>
												<th>
													<T id="settings.geo-access.presets.mode" />
												</th>
												<th>
													<T id="settings.geo-access.presets.count" />
												</th>
												<th className="text-end">
													<T id="settings.geo-access.presets.actions" />
												</th>
											</tr>
										</thead>
										<tbody>
											{values.presets.map((preset: GeoPreset) => (
												<tr key={preset.id}>
													<td>{preset.name}</td>
													<td>
														<T
															id={
																preset.mode === "deny"
																	? "settings.geo-access.mode.deny"
																	: "settings.geo-access.mode.allow"
															}
														/>
													</td>
													<td>{preset.countries.length}</td>
													<td className="text-end">
														<div className="btn-list justify-content-end">
															<Button
																size="sm"
																className="btn-outline-secondary"
																onClick={() => {
																	setPresetDraft({
																		id: preset.id,
																		name: preset.name,
																		mode: preset.mode,
																		countries: [...preset.countries],
																	});
																	setPresetError(null);
																}}
															>
																<T id="settings.geo-access.presets.edit" />
															</Button>
															<Button
																size="sm"
																className="btn-outline-danger"
																onClick={() => {
																	const nextPresets = values.presets.filter(
																		(item: GeoPreset) => item.id !== preset.id,
																	);
																	setFieldValue("presets", nextPresets);
																}}
															>
																<T id="settings.geo-access.presets.delete" />
															</Button>
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="text-muted mt-3">
									<T id="settings.geo-access.presets.empty" />
								</div>
							)}
							<div className="border rounded p-3 mt-4">
								<h5 className="mb-2">
									<T id="settings.geo-access.presets.apply.title" />
								</h5>
								<div className="text-muted mb-3">
									<T id="settings.geo-access.presets.apply.description" />
								</div>
								<div className="row align-items-end">
									<div className="col-md-6">
										<label className="form-label" htmlFor="geoAccessApplyPreset">
											<T id="settings.geo-access.presets.apply.preset" />
										</label>
										<select
											id="geoAccessApplyPreset"
											className="form-control"
											value={applyPresetId}
											onChange={(e) => {
												setApplyPresetId(e.target.value);
												setApplyError(null);
											}}
											disabled={applyTarget !== null || !values.presets?.length}
										>
											<option value="">
												<T id="settings.geo-access.presets.apply.select" />
											</option>
											{values.presets.map((preset: GeoPreset) => (
												<option key={preset.id} value={preset.id}>
													{preset.name}
												</option>
											))}
										</select>
									</div>
									<div className="col-md-6 d-flex flex-wrap gap-2 mt-3 mt-md-0">
										<Button
											actionType="primary"
											isLoading={applyTarget === "proxy-hosts"}
											disabled={applyTarget !== null || !values.presets?.length}
											onClick={() => applyPreset("proxy-hosts", values)}
										>
											<T id="settings.geo-access.presets.apply.proxy-hosts" />
										</Button>
										<Button
											actionType="primary"
											isLoading={applyTarget === "streams"}
											disabled={applyTarget !== null || !values.presets?.length}
											onClick={() => applyPreset("streams", values)}
										>
											<T id="settings.geo-access.presets.apply.streams" />
										</Button>
									</div>
								</div>
								{applyError ? (
									<div className="text-danger small mt-2">
										{applyError}
									</div>
								) : null}
							</div>
						</div>
					</div>
					<div className="card-footer bg-transparent mt-auto">
						<div className="btn-list justify-content-end">
							<Button
								type="submit"
								actionType="primary"
								className="ms-auto bg-teal"
								data-bs-dismiss="modal"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</Button>
						</div>
					</div>
				</Form>
			)}
		</Formik>
	);
}
