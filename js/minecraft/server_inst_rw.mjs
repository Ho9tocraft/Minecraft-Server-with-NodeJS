'use strict';
import { readFileSync } from 'fs';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import { createRequire } from 'module';
const req = createRequire(import.meta.url);
const SServerData = req('../validate/schema_server_data.json');
const { parse } = JSON;

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

const ajvVdr = new Ajv();

const validateServerDataJson = (str) => {
    const schemaInfo = ajvVdr.compile(SServerData);
    /**
     * @type {{servers:MinecraftServerData[]}}
     */
    const beforeValidate = parse(str);
    const valid = schemaInfo(beforeValidate);
    if (!valid) return {err: schemaInfo.errors, result: undefined};
    else return {err: 'passed', result: beforeValidate};
};

export const loadServerDataJson = (path) => {
    const validateJson = validateServerDataJson(readFileSync(path, { encoding: 'utf-8' }).toString());
    if (validateJson.err !== 'passed' || typeof validateJson.result === 'undefined') {
        console.error(`[SERVER DATA LOADER] Server Data Validation: failed, from file "${path}"`);
        throw EvalError('JSON Schema Script Cannot passed');
    }
    console.log(`[SERVER DATA LOADER] Server Data Validation: passed, from file ${path}`);
    return validateJson.result;
};
