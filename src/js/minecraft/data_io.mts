import { checkFile, loadJSONFile, saveJSONFile } from '../general_utils/json_utils.mjs';
import { emitLog } from '../general_utils/logger_utils.mjs';

const validator: {
    serverData: object | undefined,
    globalData: object | undefined
} = {
    serverData: undefined,
    globalData: undefined
}

const genErrorLogConfigNeeded = (tgt: string): string => {
    return `Configuration File ${tgt} is invalid, please check ${tgt} is exist, or mode.`;
};

const genErrorLogValidNeeded = (tgt: string): string => {
    return `Validation File ${tgt} is invalid, please check ${tgt} is exist, or mode.`;
};

const uploadServerDataJSON = (jsonObj: MinecraftServerData[]): void => {
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO = jsonObj;
}

export const loadServerDataJSON = (): ServerDataJSON => {
    const { SDJSON_PATH, SDVALIDATE_PATH } = globalThis.MCSERV_CONTROLLER_ENV.CONFIG_VALIDATE_INFO;
    validator.serverData = validator.serverData || loadJSONFile(SDVALIDATE_PATH);
    return (loadJSONFile(SDJSON_PATH, validator.serverData) as ServerDataJSON);
}

export const loadGlobalDataJSON = (): GlobalData => {
    const { GDJSON_PATH, GDVALIDATE_PATH } = globalThis.MCSERV_CONTROLLER_ENV.CONFIG_VALIDATE_INFO;
    validator.globalData = validator.globalData || loadJSONFile(GDVALIDATE_PATH);
    return (loadJSONFile(GDJSON_PATH, validator.globalData) as GlobalData);
};

export const saveServerDataJSON = (jsonObj: MinecraftServerData, supress?: boolean): void => {
    const { SERVER_CONFIG_INFO, CONFIG_VALIDATE_INFO } = globalThis.MCSERV_CONTROLLER_ENV;
    const { SDJSON_PATH, SDVALIDATE_PATH } = CONFIG_VALIDATE_INFO;
    validator.serverData = validator.serverData || loadJSONFile(SDVALIDATE_PATH);
    const replSDataArray: MinecraftServerData[] = [];
    SERVER_CONFIG_INFO.forEach((scInfo) => {
        if (jsonObj.id === scInfo.id) replSDataArray.push(jsonObj);
        else replSDataArray.push(scInfo);
    });
    uploadServerDataJSON(replSDataArray);
    const finSrvDataJSON: ServerDataJSON = { servers: globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO };
    saveJSONFile(finSrvDataJSON, SDJSON_PATH, validator.serverData, supress);
};

export const saveGlobalDataJSON = (jsonObj: GlobalData, supress?: boolean): void => {
    const { GDJSON_PATH, GDVALIDATE_PATH } = globalThis.MCSERV_CONTROLLER_ENV.CONFIG_VALIDATE_INFO;
    validator.globalData = validator.globalData || loadJSONFile(GDVALIDATE_PATH);
    saveJSONFile(jsonObj, GDJSON_PATH, validator.globalData, supress);
};

export const isAccessableNeededFiles = (): boolean => {
    const { GDJSON_PATH, SDJSON_PATH, GDVALIDATE_PATH, SDVALIDATE_PATH } = globalThis.MCSERV_CONTROLLER_ENV.CONFIG_VALIDATE_INFO;
    const { FATAL, ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    emitLog(LOG, GDJSON_PATH);
    emitLog(LOG, SDJSON_PATH);
    emitLog(LOG, GDVALIDATE_PATH);
    emitLog(LOG, SDVALIDATE_PATH);
    const tgtFileFlag = {
        sData: checkFile(SDJSON_PATH),
        sValid: checkFile(SDVALIDATE_PATH),
        gData: checkFile(GDJSON_PATH),
        gValid: checkFile(GDVALIDATE_PATH)
    };
    let result: boolean = true;
    if (result && !tgtFileFlag.sValid) {
        emitLog(FATAL, genErrorLogValidNeeded('schema_server_data.json'));
        result = false;
    }
    if (result && !tgtFileFlag.gValid) {
        emitLog(FATAL, genErrorLogValidNeeded('schema_global_data.json'));
        result = false;
    }
    if (result && !tgtFileFlag.sData) {
        emitLog(ERROR, genErrorLogConfigNeeded('server_data.json'));
        result = false;
    }
    if (result && !tgtFileFlag.gData) {
        emitLog(FATAL, genErrorLogConfigNeeded('global_data.json'));
        result = false;
    }
    if (result) emitLog(LOG, 'All Configuration File, and Validation File check done.');
    return result;
};
