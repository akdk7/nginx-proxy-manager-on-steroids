import { IconAlertTriangle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { Field, Form, Formik } from "formik";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	type Certificate,
	type ValidatedCertificateResponse,
	createCertificate,
	uploadCertificate,
	validateCertificate,
} from "src/api/backend";
import { Button } from "src/components";
import { T, formatDateTime } from "src/locale";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showCustomCertificateModal = () => {
	EasyModal.show(CustomCertificateModal);
};

const CustomCertificateModal = EasyModal.create(({ visible, remove }: InnerModalProps) => {
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState<ReactNode | null>(null);
	const [validationErrorMsg, setValidationErrorMsg] = useState<ReactNode | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isValidating, setIsValidating] = useState(false);
	const [validationResult, setValidationResult] = useState<ValidatedCertificateResponse | null>(null);
	const validationRequest = useRef(0);

	const buildValidationFormData = useCallback((values: any) => {
		const formData = new FormData();
		if (values.certificate) {
			formData.append("certificate", values.certificate);
		}
		if (values.certificateKey) {
			formData.append("certificate_key", values.certificateKey);
		}
		if (values.intermediateCertificate) {
			formData.append("intermediate_certificate", values.intermediateCertificate);
		}
		return formData;
	}, []);

	const runValidation = useCallback(async (values: any) => {
		const hasFiles = values.certificate || values.certificateKey || values.intermediateCertificate;
		if (!hasFiles) {
			setValidationResult(null);
			setValidationErrorMsg(null);
			setIsValidating(false);
			return;
		}

		const requestId = ++validationRequest.current;
		setIsValidating(true);
		setValidationErrorMsg(null);

		try {
			const result = await validateCertificate(buildValidationFormData(values));
			if (validationRequest.current !== requestId) {
				return;
			}
			setValidationResult(result);
		} catch (err: any) {
			if (validationRequest.current !== requestId) {
				return;
			}
			setValidationResult(null);
			setValidationErrorMsg(<T id={err.message} />);
		} finally {
			if (validationRequest.current === requestId) {
				setIsValidating(false);
			}
		}
	}, [buildValidationFormData]);

	const handleFileChange = (form: any, fieldName: string, file: File | null) => {
		const nextValues = { ...form.values, [fieldName]: file };
		form.setFieldValue(fieldName, file);
		runValidation(nextValues);
	};

	const renderCertificateDetails = (titleId: string, details?: ValidatedCertificateResponse["certificate"]) => {
		if (!details) {
			return null;
		}
		const validFrom = details.dates?.from ? formatDateTime(details.dates.from) : "-";
		const validTo = details.dates?.to ? formatDateTime(details.dates.to) : "-";

		return (
			<div className="mb-3">
				<h6 className="mb-2">
					<T id={titleId} />
				</h6>
				<dl className="row mb-0">
					<dt className="col-sm-4">
						<T id="certificates.custom.details.cn" />
					</dt>
					<dd className="col-sm-8">{details.cn || "-"}</dd>
					<dt className="col-sm-4">
						<T id="certificates.custom.details.issuer" />
					</dt>
					<dd className="col-sm-8">{details.issuer || "-"}</dd>
					<dt className="col-sm-4">
						<T id="certificates.custom.details.valid-from" />
					</dt>
					<dd className="col-sm-8">{validFrom}</dd>
					<dt className="col-sm-4">
						<T id="certificates.custom.details.valid-to" />
					</dt>
					<dd className="col-sm-8">{validTo}</dd>
				</dl>
			</div>
		);
	};

	const renderStatusRow = (labelId: string, status?: boolean, okId?: string, badId?: string) => {
		if (typeof status === "undefined") {
			return null;
		}
		const badgeClass = status ? "bg-lime-lt" : "bg-danger-lt";
		const badgeTextId = status ? okId : badId;

		return (
			<div className="d-flex align-items-center gap-2 mb-2">
				<span className="text-muted">
					<T id={labelId} />
				</span>
				{badgeTextId ? (
					<span className={`badge ${badgeClass}`}>
						<T id={badgeTextId} />
					</span>
				) : null}
			</div>
		);
	};

	const onSubmit = async (values: any, { setSubmitting }: any) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			const { niceName, provider } = values;
			const formData = buildValidationFormData(values);

			// Validate
			const validations = await validateCertificate(formData);
			if (validations.certificateKeyMatches === false) {
				throw new Error("certificates.custom.key-mismatch");
			}

			// Create certificate, as other without anything else
			const cert = await createCertificate({ niceName, provider } as Certificate);

			// Upload the certificates to the created certificate
			await uploadCertificate(cert.id, formData);

			// Success
			showObjectSuccess("certificate", "saved");
			remove();
		} catch (err: any) {
			setErrorMsg(<T id={err.message} />);
		}

		queryClient.invalidateQueries({ queryKey: ["certificates"] });
		setIsSubmitting(false);
		setSubmitting(false);
	};

	return (
		<Modal show={visible} onHide={remove}>
			<Formik
				initialValues={
					{
						niceName: "",
						provider: "other",
						certificate: null,
						certificateKey: null,
						intermediateCertificate: null,
					} as any
				}
				onSubmit={onSubmit}
			>
				{() => (
					<Form>
						<Modal.Header closeButton>
							<Modal.Title>
								<T id="object.add" tData={{ object: "lets-encrypt-via-dns" }} />
							</Modal.Title>
						</Modal.Header>
						<Modal.Body className="p-0">
							<Alert variant="danger" show={!!errorMsg} onClose={() => setErrorMsg(null)} dismissible>
								{errorMsg}
							</Alert>
							<Alert
								variant="danger"
								show={!!validationErrorMsg}
								onClose={() => setValidationErrorMsg(null)}
								dismissible
							>
								{validationErrorMsg}
							</Alert>
							<div className="card m-0 border-0">
								<div className="card-body">
									<p className="text-warning">
										<IconAlertTriangle size={16} className="me-1" />
										<T id="certificates.custom.warning" />
									</p>
									<Field name="niceName" validate={validateString(1, 255)}>
										{({ field, form }: any) => (
											<div className="mb-3">
												<label htmlFor="niceName" className="form-label">
													<T id="column.name" />
												</label>
												<input
													id="niceName"
													type="text"
													required
													autoComplete="off"
													className="form-control"
													{...field}
												/>
												{form.errors.niceName ? (
													<div className="invalid-feedback">
														{form.errors.niceName && form.touched.niceName
															? form.errors.niceName
															: null}
													</div>
												) : null}
											</div>
										)}
									</Field>
									<Field name="certificateKey">
										{({ field, form }: any) => (
											<div className="mb-3">
												<label htmlFor="certificateKey" className="form-label">
													<T id="certificate.custom-certificate-key" />
												</label>
												<input
													id="certificateKey"
													type="file"
													required
													autoComplete="off"
													className="form-control"
													onChange={(event) => {
														handleFileChange(
															form,
															field.name,
															event.currentTarget.files?.length
																? event.currentTarget.files[0]
																: null,
														);
													}}
												/>
												{form.errors.certificateKey ? (
													<div className="invalid-feedback">
														{form.errors.certificateKey && form.touched.certificateKey
															? form.errors.certificateKey
															: null}
													</div>
												) : null}
											</div>
										)}
									</Field>
									<Field name="certificate">
										{({ field, form }: any) => (
											<div className="mb-3">
												<label htmlFor="certificate" className="form-label">
													<T id="certificate.custom-certificate" />
												</label>
												<input
													id="certificate"
													type="file"
													required
													autoComplete="off"
													className="form-control"
													onChange={(event) => {
														handleFileChange(
															form,
															field.name,
															event.currentTarget.files?.length
																? event.currentTarget.files[0]
																: null,
														);
													}}
												/>
												{form.errors.certificate ? (
													<div className="invalid-feedback">
														{form.errors.certificate && form.touched.certificate
															? form.errors.certificate
															: null}
													</div>
												) : null}
											</div>
										)}
									</Field>
									<Field name="intermediateCertificate">
										{({ field, form }: any) => (
											<div className="mb-3">
												<label htmlFor="intermediateCertificate" className="form-label">
													<T id="certificate.custom-intermediate" />
												</label>
												<input
													id="intermediateCertificate"
													type="file"
													autoComplete="off"
													className="form-control"
													onChange={(event) => {
														handleFileChange(
															form,
															field.name,
															event.currentTarget.files?.length
																? event.currentTarget.files[0]
																: null,
														);
													}}
												/>
												{form.errors.intermediateCertificate ? (
													<div className="invalid-feedback">
														{form.errors.intermediateCertificate &&
														form.touched.intermediateCertificate
															? form.errors.intermediateCertificate
															: null}
													</div>
												) : null}
											</div>
										)}
									</Field>
								</div>
								{isValidating || validationResult ? (
									<div className="card-footer">
										<h5 className="mb-3">
											<T id="certificates.custom.details" />
										</h5>
										{isValidating ? (
											<p className="text-muted mb-3">
												<T id="loading" />
											</p>
										) : null}
										{validationResult ? (
											<>
												{renderCertificateDetails(
													"certificates.custom.details.certificate",
													validationResult.certificate,
												)}
												{renderCertificateDetails(
													"certificates.custom.details.intermediate",
													validationResult.intermediateCertificate,
												)}
												{renderStatusRow(
													"certificate.custom-certificate-key",
													validationResult.certificateKey,
													"certificates.custom.status.valid",
													"certificates.custom.status.invalid",
												)}
												{renderStatusRow(
													"certificates.custom.key-match",
													validationResult.certificateKeyMatches,
													"certificates.custom.status.match",
													"certificates.custom.status.mismatch",
												)}
											</>
										) : null}
									</div>
								) : null}
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button data-bs-dismiss="modal" onClick={remove} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								actionType="primary"
								className="ms-auto bg-pink"
								data-bs-dismiss="modal"
								isLoading={isSubmitting}
								disabled={isSubmitting || isValidating || validationResult?.certificateKeyMatches === false}
							>
								<T id="save" />
							</Button>
						</Modal.Footer>
					</Form>
				)}
			</Formik>
		</Modal>
	);
});

export { showCustomCertificateModal };
