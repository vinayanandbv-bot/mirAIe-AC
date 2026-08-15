import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { PanasonicMiraiePlatform } from './platform.js';
export default (api) => {
    api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, PanasonicMiraiePlatform);
};
