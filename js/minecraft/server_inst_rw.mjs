'use strict';
import { accessSync, constants, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createRequire } from 'module';
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import { MinecraftServer } from './server_instance.mjs';
const { dirname, url } = import.meta;
const req = createRequire(url);
const { parse, stringify } = JSON;

const ajvVdr = new Ajv();

/**
 * server_data.jsonの記述が間違っていないかバリデーションします。
 * @param {string} str JSON文字列
 * @returns エラーメッセージか、passedを記入したerrと、undefinedか、解析後のobjectが内包されたresultを内包したobject
 */
const validateServerDataJson = (str) => {
    const SServerData = req('../validate/schema_server_data.json');
    const schemaInfo = ajvVdr.compile(SServerData);
    /**
     * @type {{servers:MinecraftServerData[]}}
     */
    const beforeValidate = parse(str);
    const valid = schemaInfo(beforeValidate);
    if (!valid) return {err: schemaInfo.errors, result: undefined};
    else return {err: 'passed', result: beforeValidate};
};

/**
 * server_data.jsonを読み込みます。
 * @returns 解析後のobject
 * @throws JSONバリデーションが失敗した場合にEvalError
 */
export const loadServerDataJson = () => {
    const path = join(dirname, './../../data/server_data.json');
    if (!checkFile(path)) {
        console.error('[Server DATA LOADER] File not found, or cannot accessable. Process Aborted');
        throw new EvalError('File server_data.json Error');
    }
    const validLog = '[SERVER DATA LOADER] Server Data Validation:';
    const validateJson = validateServerDataJson(readFileSync(path, { encoding: 'utf-8' }).toString());
    if (validateJson.err !== 'passed' || typeof validateJson.result === 'undefined') {
        console.error(`${validLog} failed, from file "${path}"`);
        throw new EvalError('JSON Schema Script Cannot passed');
    }
    console.log(`${validLog} passed, from file "${path}"`);
    return validateJson.result;
};

/**
 * global_data.jsonの記述が間違っていないかバリデーションします。
 * @param {string} str JSON文字列
 * @returns エラーメッセージか、passedを記入したerrと、undefinedか、解析後のobjectが内包されたresultを内包したobject
 */
const validateGlobalDataJson = (str) => {
    const SGlobalData = req('../validate/schema_global_data.json');
    const schemaInfo = ajvVdr.compile(SGlobalData);
    /**
     * @type {GlobalData}
     */
    const beforeValidate = parse(str);
    const valid = schemaInfo(beforeValidate);
    if (!valid) return {err: schemaInfo.errors, result: undefined};
    else return {err: 'passed', result: beforeValidate};
};

/**
 * global_data.jsonを読み込みます。
 * @returns 解析後のobject
 * @throws JSONバリデーションが失敗した場合にEvalError
 */
export const loadGlobalDataJson = () => {
    const path = join(dirname, './../../data/global_data.json');
    if (!checkFile(path)) {
        console.error('[GLOBAL DATA LOADER] File not found, or cannot accessable. Process Aborted');
        throw new EvalError('File global_data.json Error');
    }
    const validLog = '[GLOBAL DATA LOADER] Global Data Validation:';
    const validateJson = validateGlobalDataJson(readFileSync(path, { encoding: 'utf-8' }).toString());
    if (validateJson.err !== 'passed' || typeof validateJson.result === 'undefined') {
        console.error(`${validLog} failed, from file "${path}"`);
        throw new EvalError('JSON Schema Script Cannot passed');
    }
    console.log(`${validLog} passed, from file "${path}"`);
    return validateJson.result;
};

/**
 * デフォルトのdayRebootをglobalThisから抽出するものです。
 * @returns dayReboot object
 */
export const outputDayReboot = () => {
    return globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG.global_data.serverScheduleTime.dayReboot;
};
/**
 * デフォルトのweeklyShutdownをglobalThisから抽出するものです。
 * @returns weeklyShutdown object
 */
export const outputWeeklyShutdown = () => {
    return globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG.global_data.serverScheduleTime.weeklyShutdown;
};

const syncServerDataJsonToFile = () => {
    const path = join(dirname, '../../data/server_data.json');
    const saveLog = '[SERVER DATA SYNC] Server Data Sync:';
    if (!checkFile(path)) {
        console.error(`${saveLog} File not found, or cannot accessable. Process Aborted`);
        throw new EvalError('File server_data.json Error');
    }
    const saveTo = { servers: globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO };
    const jsonStr = stringify(saveTo, undefined, 4);
    const validateJson = validateServerDataJson(jsonStr);
    if (validateJson.err !== 'passed' || typeof validateJson.result === 'undefined') {
        console.error(`${saveLog} failed, provided JSON String is invalid`);
        throw new EvalError('JSON Schema Script Cannot passed');
    }
    console.log(`${saveLog} passed, Preparing to save to server_data.json`);
    writeFileSync(path, jsonStr, { encoding: 'utf-8' });
};

/**
 * globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFOを新しいデータに置換します。
 * @param {MinecraftServerData} jsonObj 
 */
export const saveServerDataJson = (jsonObj) => {
    /**
     * @type {MinecraftServerData[]}
     */
    let replaceToInfo = [];
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO.forEach((srvInfo) => {
        if (srvInfo.id === jsonObj.id) replaceToInfo.push(jsonObj);
        else replaceToInfo.push(srvInfo);
    });
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO = replaceToInfo;
    syncServerDataJsonToFile();
};

/**
 * ファイルの有無を確認します。
 * @param {string} path ファイルパス(絶対参照)
 * @returns あるならtrue / ない、もしくは権限不足の場合false
 */
export const checkFile = (path) => {
    const { F_OK, R_OK, W_OK } = constants;
    try {
        accessSync(path, F_OK | R_OK | W_OK);
        return true;
    } catch {
        console.error('[ERROR] Target File invalid.');
        return false;
    }
};

/**
 * 必要なファイルが足りているかどうかを確認します。
 * @returns あるならtrue / ない、もしくは権限不足の場合false
 */
export const isAccessableNeededFiles = () => {
    const tgtFileFlag = {
        serverData: checkFile(join(dirname, '../../data/server_data.json')),
        globalData: checkFile(join(dirname, '../../data/global_data.json'))
    };
    if (!tgtFileFlag.serverData) {
        console.error('[ERROR] Configuration File server_data.json is invalid, please check server_data.json is exist, or mode.');
        return false;
    }
    if (!tgtFileFlag.globalData) {
        console.error('[FATAL] Configuration File global_data.json is invalid, please check global_data.json is exist, or mode.');
        return false;
    }
    console.log('[SYSOUT] All Configuration File check done.');
    return true;
};

/**
 * サーバーインスタンスを生成します。
 */
export const generateServerInstance = () => {
    const { SERVER_CONFIG_INFO }  = globalThis.MCSERV_CONTROLLER_ENV;
    SERVER_CONFIG_INFO.forEach((serverJSON) => {
        globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.push(new MinecraftServer(serverJSON));
    });
};
