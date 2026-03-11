import { checkFile, loadJSONFile } from '../general_utils/json_utils.mjs';
import { emitLog } from '../general_utils/logger_utils.mjs';

const { GDJSON_PATH, SDJSON_PATH, GDVALIDATE_PATH, SDVALIDATE_PATH } = globalThis.MCSERV_CONTROLLER_ENV.CONFIG_VALIDATE_INFO;

const genErrorLogConfigNeeded = (tgt: string): string => {
    return `Configuration File ${tgt} is invalid, please check ${tgt} is exist, or mode.`;
};

const genErrorLogValidNeeded = (tgt: string): string => {
    return `Validation File ${tgt} is invalid, please check ${tgt} is exist, or mode.`;
};

export const loadServerDataJSON = (): ServerDataJSON => {
    const schemaJSON = loadJSONFile(SDVALIDATE_PATH);
    return (loadJSONFile(SDJSON_PATH, schemaJSON) as ServerDataJSON);
}

export const loadGlobalDataJSON = (): GlobalData => {
    const schemaJSON = loadJSONFile(GDVALIDATE_PATH);
    return (loadJSONFile(GDJSON_PATH, schemaJSON) as GlobalData);
};

export const isAccessableNeededFiles = (): boolean => {
    const { FATAL, ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
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
