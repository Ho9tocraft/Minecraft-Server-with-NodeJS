'use strict';
import { parseArgs } from 'util';
import { coreModuleInitProcess } from './js/core_process.mjs';
const { main, dirname: __dirname } = import.meta;

const launchOptions = {
    'launch-debug': {
        type: 'boolean',
        short: 'd'
    }
};
const args = process.argv.slice(2);

const initGlobalThisEnv = () => {
    globalThis.DEBUG_MODE = false;
    globalThis.MCSERV_CONTROLLER_ENV = {
        SERVER_CONFIG_INFO: [],
        SERVER_INSTANCES: [],
        GLOBAL_CONFIG: {}
    };
};

const runMain = () => {
    try {
        coreModuleInitProcess();
    } catch (err) {
        console.error('[FATAL] MINECRAFT SERVER CONTROLLER catched error: CRITICAL_PROCESS_DIED');
        console.error(err);
    }
};

if (main) {
    initGlobalThisEnv();
    const { values } = parseArgs({ args, options: launchOptions });
    globalThis.DEBUG_MODE = values['launch-debug'];
    runMain();
}
