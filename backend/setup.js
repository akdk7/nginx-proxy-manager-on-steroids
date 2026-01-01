import { installPlugins } from "./lib/certbot.js";
import utils from "./lib/utils.js";
import { setup as logger } from "./logger.js";
import authModel from "./models/auth.js";
import certificateModel from "./models/certificate.js";
import settingModel from "./models/setting.js";
import userModel from "./models/user.js";
import userPermissionModel from "./models/user_permission.js";
import { createSetup } from "./setup-helpers.js";

const setup = createSetup({
	userModel,
	authModel,
	userPermissionModel,
	settingModel,
	certificateModel,
	installPlugins,
	utils,
	logger,
});

export const {
	isSetup,
	setupDefaultUser,
	setupDefaultSettings,
	setupCertbotPlugins,
	setupLogrotation,
} = setup;

export default setup.run;
