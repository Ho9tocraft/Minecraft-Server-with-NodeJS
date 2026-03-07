'use strict';
import { decryptRConPasswd } from './js/minecraft/rcon_authorize.mjs';
import { loadServerDataJson } from './js/minecraft/server_inst_rw.mjs';
import { decryptEncryptedString } from './js/mcsrvcon_utils/decrypt_utils.mjs';
import { join } from 'path';
import { parseArgs } from 'util';
const { main, dirname: __dirname } = import.meta;

const launchOptions = {
    'launch-debug': {
        type: 'boolean',
        short: 'd'
    }
};
const args = process.argv.slice(2);

const runMain = () => {
    /**
     * @typedef {object} MinecraftServerData
     * @property {string} id
     * @property {object} work
     * @property {string} work.jvmPath
     * @property {object} work.jvmArgs
     * @property {object} work.jvmArgs.memory
     * @property {string} work.jvmArgs.extra
     * @property {string} work.jarFile
     * @property {string} work.jarArgs
     * @property {object} work.rcon
     * @property {number} work.rcon.port
     * @property {string} work.rcon.passwdMode
     * @property {string} work.rcon.passwd
     * @property {object} process
     * @property {string} process.runningStatus
     * @property {boolean} process.maintenanceMode
     * @property {object} process.scheduleTime
     * @property {string} process.scheduleTime.serverExecStart
     * @property {object} process.scheduleTime.override
     * @property {object} process.scheduleTime.override.dayReboot
     * @property {boolean} process.scheduleTime.override.dayReboot.doOverride
     * @property {string} process.scheduleTime.override.dayReboot.motd
     * @property {string} process.scheduleTime.override.dayReboot.exec
     * @property {object} process.scheduleTime.override.weeklyShutdown
     * @property {boolean} process.scheduleTime.override.weeklyShutdown.doOverride
     * @property {string} process.scheduleTime.override.weeklyShutdown.motd
     * @property {string} process.scheduleTime.override.weeklyShutdown.exec
     */
    /**
     * @type {{servers: MinecraftServerData[]}}
     */
    const { servers } = loadServerDataJson(join(__dirname, './data/server_data.json'));
    servers.forEach(server => {
        // server script loading
        if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Loaded Server ID: ${server.id}`);
        if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Target serverExecStart: ${server.process.scheduleTime.serverExecStart}`);
        if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Decryption rcon.password: ${decryptRConPasswd(server)}`);
    });
    if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Extra Words Decryption Evade test: ${decryptEncryptedString('54a+6IGW44Gu57WC5ruF5bm75oOz')}`);
};

if (main) {
    const { values } = parseArgs({ args, options: launchOptions });
    globalThis.DEBUG_MODE = values['launch-debug'];
    runMain();
}
