import { Button } from "src/components";
import { T } from "src/locale";

type CheatContext = "server" | "location";

interface Snippet {
	id: string;
	labelId: string;
	snippet: string;
}

interface Props {
	value?: string;
	onChange: (value: string) => void;
	context?: CheatContext;
}

const SNIPPETS: Snippet[] = [
	{
		id: "client-max-body",
		labelId: "nginx-config.cheat.snippet.client-max-body",
		snippet: "client_max_body_size 50m;\n",
	},
	{
		id: "proxy-timeouts",
		labelId: "nginx-config.cheat.snippet.proxy-timeouts",
		snippet: "proxy_connect_timeout 10s;\nproxy_send_timeout 90s;\nproxy_read_timeout 90s;\n",
	},
	{
		id: "proxy-buffering-off",
		labelId: "nginx-config.cheat.snippet.proxy-buffering-off",
		snippet: "proxy_buffering off;\n",
	},
	{
		id: "proxy-request-buffering-off",
		labelId: "nginx-config.cheat.snippet.proxy-request-buffering-off",
		snippet: "proxy_request_buffering off;\n",
	},
	{
		id: "access-log-off",
		labelId: "nginx-config.cheat.snippet.access-log-off",
		snippet: "access_log off;\n",
	},
];

const appendSnippet = (current: string, snippet: string) => {
	if (!current) {
		return snippet;
	}
	const needsNewline = !current.endsWith("\n");
	return `${current}${needsNewline ? "\n" : ""}${snippet}`;
};

export function NginxConfigCheatSheet({
	value = "",
	onChange,
	context = "server",
}: Props) {
	const contextKey =
		context === "location"
			? "nginx-config.cheat.context.location"
			: "nginx-config.cheat.context.server";

	return (
		<details className="mt-2">
			<summary className="text-muted small">
				<T id="nginx-config.cheat.title" />
			</summary>
			<div className="border rounded p-2 mt-2">
				<div className="text-muted small mb-1">
					<T id={contextKey} />
				</div>
				<div className="text-muted small mb-2">
					<T id="nginx-config.cheat.subtitle" />
				</div>
				<div className="text-muted small mb-2">
					<T id="nginx-config.cheat.hints" />
				</div>
				<div className="text-muted small mb-3">
					<T id="nginx-config.cheat.variables" />
				</div>
				{SNIPPETS.map((snippet) => (
					<div key={snippet.id} className="d-flex align-items-start gap-2 mb-2">
						<div className="flex-grow-1">
							<div className="text-muted small">
								<T id={snippet.labelId} />
							</div>
							<pre className="mb-0 small">
								<code>{snippet.snippet.trimEnd()}</code>
							</pre>
						</div>
						<Button
							size="sm"
							variant="outline"
							onClick={() => onChange(appendSnippet(value, snippet.snippet))}
						>
							<T id="action.insert" />
						</Button>
					</div>
				))}
			</div>
		</details>
	);
}
