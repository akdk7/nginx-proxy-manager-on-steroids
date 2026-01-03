import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

const normalizeGeoCountriesInput = (value: unknown) => {
	if (Array.isArray(value)) {
		return value.join(", ");
	}
	if (typeof value === "string") {
		return value;
	}
	return "";
};

const parseGeoCountriesInput = (value: string) => {
	if (!value) {
		return [];
	}
	const parts = value
		.split(/[\s,]+/)
		.map((part) => part.trim().toUpperCase())
		.filter(Boolean);
	const unique = new Set<string>();
	const result: string[] = [];
	parts.forEach((part) => {
		if (!/^[A-Z]{2}$/.test(part) || unique.has(part)) {
			return;
		}
		unique.add(part);
		result.push(part);
	});
	return result;
};

export default function GeoAccess() {
	const { data, isLoading, error } = useSetting("geo-access");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const countries = parseGeoCountriesInput(values.countriesInput || "");

		const payload = {
			id: "geo-access",
			value: "geo-access",
			meta: {
				httpEnabled: !!values.httpEnabled,
				streamEnabled: !!values.streamEnabled,
				dbPath: `${values.dbPath || ""}`.trim(),
				mode: values.mode || "allow",
				countries,
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
		const countries = parseGeoCountriesInput(values.countriesInput || "");
		if (enabled && !dbPath) {
			errors.dbPath = intl.formatMessage({ id: "error.required" });
		}
		if (enabled && (values.mode || "allow") === "allow" && countries.length === 0) {
			errors.countriesInput = intl.formatMessage({ id: "error.geo-access.countries-required" });
		}
		return errors;
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
					httpEnabled: data?.meta?.httpEnabled || false,
					streamEnabled: data?.meta?.streamEnabled || false,
					dbPath: data?.meta?.dbPath || "/data/GeoLite2-Country.mmdb",
					mode: data?.meta?.mode || "allow",
					countriesInput: normalizeGeoCountriesInput(data?.meta?.countries),
				} as any
			}
			validate={validate}
			onSubmit={onSubmit}
		>
			{({ values, submitCount, setFieldValue }) => (
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
							<Field name="countriesInput">
								{({ field, form }: any) => (
									<div>
										<label className="form-label" htmlFor="geoAccessCountries">
											<T id="settings.geo-access.countries" />
										</label>
										<input
											{...field}
											id="geoAccessCountries"
											type="text"
											className={`form-control ${
												form.errors.countriesInput && submitCount > 0 ? "is-invalid" : ""
											}`}
											placeholder="DE, AT, CH"
											onChange={(e) => form.setFieldValue(field.name, e.target.value)}
										/>
										{form.errors.countriesInput && submitCount > 0 ? (
											<div className="invalid-feedback d-block">{form.errors.countriesInput}</div>
										) : null}
									</div>
								)}
							</Field>
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
