import { HasPermission } from "src/components";
import { ADMIN, VIEW } from "src/modules/Permissions";
import LogsView from "./LogsView";

const Logs = () => {
	return (
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<LogsView />
		</HasPermission>
	);
};

export default Logs;
