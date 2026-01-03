import { Field, Form, Formik } from "formik";
import { type ReactNode, useState } from "react";
import { Alert } from "react-bootstrap";
import { Button, Loading } from "src/components";
import { useSetSetting, useSetting } from "src/hooks";
import { intl, T } from "src/locale";
import { showObjectSuccess } from "src/notifications";

const normalizePorts = (ports: unknown): string[] => {
	if (!Array.isArray(ports)) {
		return [];
	}
	const parsedPorts: number[] = ports
		.map((port) => Number.parseInt(`${port}`, 10))
		.filter((port) => Number.isFinite(port) && port >= 1 && port <= 65535);
	return Array.from(new Set<number>(parsedPorts))
		.sort((a, b) => a - b)
		.map((port) => `${port}`);
};

export default function ProxyProtocol() {
	const { data, isLoading, error } = useSetting("proxy-protocol");
	const { mutate: setSetting } = useSetSetting();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const rawPorts = Array.isArray(values.ports) ? values.ports : [];
		const parsedPorts: number[] = rawPorts
			.map((port: string) => Number.parseInt(`${port}`, 10))
			.filter((port: number) => Number.isFinite(port) && port >= 1 && port <= 65535);
		const uniquePorts = Array.from(new Set<number>(parsedPorts)).sort((a, b) => a - b);

		const payload = {
			id: "proxy-protocol",
			value: "ports",
			meta: {
				ports: uniquePorts,
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
		const ports = Array.isArray(values.ports) ? values.ports : [];
		const portErrors: string[] = [];
		const seen = new Set<number>();

		ports.forEach((port: string, index: number) => {
			const raw = `${port}`.trim();
			if (!raw) {
				portErrors[index] = intl.formatMessage({ id: "error.required" });
				return;
			}
			const parsed = Number.parseInt(raw, 10);
			if (!Number.isFinite(parsed)) {
				portErrors[index] = intl.formatMessage({ id: "error.required" });
				return;
			}
			if (parsed < 1) {
				portErrors[index] = intl.formatMessage({ id: "error.minimum" }, { min: 1 });
				return;
			}
			if (parsed > 65535) {
				portErrors[index] = intl.formatMessage({ id: "error.maximum" }, { max: 65535 });
				return;
			}
			if (seen.has(parsed)) {
				portErrors[index] = intl.formatMessage({ id: "error.duplicate-port" });
				return;
			}
			seen.add(parsed);
		});

		if (portErrors.length) {
			errors.ports = portErrors;
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
					ports: normalizePorts(data?.meta?.ports),
				} as any
			}
			validate={validate}
			onSubmit={onSubmit}
		>
			{({ values, setFieldValue, errors, submitCount }) => {
				const ports = Array.isArray(values.ports) ? values.ports : [];

				const handleAdd = () => {
					setFieldValue("ports", [...ports, ""]);
				};

				const handleRemove = (index: number) => {
					const nextPorts = ports.filter((_: string, idx: number) => idx !== index);
					setFieldValue("ports", nextPorts);
				};

				return (
					<Form>
						<div className="card-body">
							<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
								{errorMsg}
							</Alert>
							<div className="mb-4">
								<h3 className="mb-1">
									<T id="settings.proxy-protocol" />
								</h3>
							<div className="text-muted">
								<T id="settings.proxy-protocol.description" />
							</div>
							<Alert variant="warning" className="mt-3">
								<T id="settings.proxy-protocol.notice" />
							</Alert>
						</div>
							<div className="table-responsive">
								<table className="table table-vcenter">
									<thead>
										<tr>
											<th>
												<T id="settings.proxy-protocol.port" />
											</th>
											<th className="w-1" />
										</tr>
									</thead>
									<tbody>
										{ports.length ? (
											ports.map((_: string, idx: number) => {
												const portErrors = Array.isArray(errors.ports) ? errors.ports : [];
												const portError =
													typeof portErrors[idx] === "string" ? portErrors[idx] : undefined;
												return (
													<tr key={`proxy-protocol-port-${idx}`}>
														<td>
															<Field name={`ports.${idx}`}>
																{({ field, form }: any) => (
																	<div>
																		<input
																			{...field}
																			type="number"
																			min={1}
																			max={65535}
																			className={`form-control ${
																				portError && submitCount > 0 ? "is-invalid" : ""
																			}`}
																			value={field.value ?? ""}
																			onChange={(e) =>
																				form.setFieldValue(field.name, e.target.value)
																			}
																		/>
																		{portError && submitCount > 0 ? (
																			<div className="invalid-feedback d-block">{portError}</div>
																		) : null}
																	</div>
																)}
															</Field>
														</td>
														<td className="text-end">
															<button
																type="button"
																className="btn btn-sm"
																onClick={() => handleRemove(idx)}
															>
																<T id="action.delete" />
															</button>
														</td>
													</tr>
												);
											})
										) : (
											<tr>
												<td colSpan={2}>
													<div className="text-muted small">
														<T id="settings.proxy-protocol.empty" />
													</div>
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
							<button type="button" className="btn btn-sm" onClick={handleAdd}>
								<T id="action.add" />
							</button>
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
				);
			}}
		</Formik>
	);
}
