import { loadCacheFile } from './js/general_utils/json_utils.mjs';
import { initGlobalThisVariables } from './js/core_process.mjs';

initGlobalThisVariables();
globalThis.DEBUG_MODE = true;
loadCacheFile();
console.log(globalThis.MCSERV_CONTROLLER_ENV.SRVINST_CACHE);
