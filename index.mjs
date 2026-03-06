'use strict';
import { decryptRConPasswd } from './js/minecraft/rcon_authorize.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';
const { parse } = JSON;
const { dirname: __dirname } = import.meta;

const main = () => {
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
    const { servers } = parse(readFileSync(join(__dirname, './data/server_data.json'), { encoding: 'utf-8' }));
    servers.forEach(server => {
        // server script loading
    });
};

if (import.meta.main) {
    main();
}
