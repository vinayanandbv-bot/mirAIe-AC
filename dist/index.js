import { PLATFORM_NAME } from './settings.js';
import { PanasonicMiraiePlatform } from './platform.js';
export default (api) => {
    api.registerPlatform(PLATFORM_NAME, PanasonicMiraiePlatform);
};
