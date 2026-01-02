import CodeEditor from "@uiw/react-textarea-code-editor";
import EasyModal, { type InnerModalProps } from "ez-modal-react";
import { useEffect, useState } from "react";
import { Alert } from "react-bootstrap";
import Modal from "react-bootstrap/Modal";
import {
	getDeadHostConfig,
	getProxyHostConfig,
	getRedirectionHostConfig,
	getStreamConfig,
} from "src/api/backend";
import { Button, Loading } from "src/components";
import { T } from "src/locale";

type HostConfigType = "proxy-host" | "redirection-host" | "dead-host" | "stream";

const showNginxConfigModal = (type: HostConfigType, id: number) => {
	EasyModal.show(NginxConfigModal, { type, id });
};

interface Props extends InnerModalProps {
	id: number;
	type: HostConfigType;
}

const NginxConfigModal = EasyModal.create(({ id, type, visible, remove }: Props) => {
	const [configText, setConfigText] = useState("");
	const [error, setError] = useState<Error | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	useEffect(() => {
		if (!visible) {
			return;
		}
		let active = true;
		setIsLoading(true);
		setError(null);
		setConfigText("");

		const loadConfig = async () => {
			switch (type) {
				case "proxy-host":
					return getProxyHostConfig(id);
				case "redirection-host":
					return getRedirectionHostConfig(id);
				case "dead-host":
					return getDeadHostConfig(id);
				case "stream":
					return getStreamConfig(id);
				default:
					return Promise.resolve("");
			}
		};

		loadConfig()
			.then((text) => {
				if (!active) {
					return;
				}
				setConfigText(text);
			})
			.catch((err: Error) => {
				if (!active) {
					return;
				}
				setError(err);
			})
			.finally(() => {
				if (active) {
					setIsLoading(false);
				}
			});

		return () => {
			active = false;
		};
	}, [id, type, visible]);

	return (
		<Modal show={visible} onHide={remove} size="lg">
			{error && !isLoading ? (
				<Alert variant="danger" className="m-3">
					{error.message || "Unknown error"}
				</Alert>
			) : null}
			{isLoading ? (
				<Loading noLogo />
			) : (
				<>
					<Modal.Header closeButton>
						<Modal.Title>
							<T id="action.view-config" />
						</Modal.Title>
					</Modal.Header>
					<Modal.Body>
						<CodeEditor
							language="nginx"
							padding={15}
							data-color-mode="dark"
							minHeight={300}
							indentWidth={2}
							style={{
								fontFamily:
									"ui-monospace,SFMono-Regular,SF Mono,Consolas,Liberation Mono,Menlo,monospace",
								borderRadius: "0.3rem",
								minHeight: "300px",
								backgroundColor: "var(--tblr-bg-surface-dark)",
							}}
							readOnly
							value={configText}
						/>
					</Modal.Body>
					<Modal.Footer>
						<Button data-bs-dismiss="modal" onClick={remove}>
							<T id="action.close" />
						</Button>
					</Modal.Footer>
				</>
			)}
		</Modal>
	);
});

export { showNginxConfigModal, type HostConfigType };
