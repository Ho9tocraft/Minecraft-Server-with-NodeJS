import { accessSync, constants, readFileSync, writeFileSync } from 'fs';
import { type as OSType } from 'os';
import { execSync, spawnSync } from 'child_process';
import { Ajv2020 as Ajv, type ErrorObject } from 'ajv/dist/2020.js';
import { emitLog } from './logger_utils.mjs';
const { parse, stringify } = JSON;
const ajvVdr = new Ajv();
const isWin = /windows/i.test(OSType().toString());

type jsonValidateResult = {
    err: ErrorObject<string, Record<string, any>, unknown>[] | null | undefined | 'passed';
    result: object | undefined;
};

export const checkExec = (cmd: string, fullPathMode?: boolean): boolean => {
    const isFullPath = typeof fullPathMode === 'boolean' ? fullPathMode : false;
    if (!isFullPath) {
        try {
            execSync(`${isWin ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
            return true;
        } catch {
            return false;
        }
    }
    else {
        const output = spawnSync(isWin ? `${cmd}` : `which`, [isWin ? `2>&1` : cmd]);
        const { status, error } = output;
        if (!isWin) return status === 0;
        return typeof error === 'undefined';
    }
};

export const checkFile = (fullPath: string): boolean => {
    const ERROR = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES.ERROR;
    const { F_OK, R_OK, W_OK } = constants;
    try {
        accessSync(fullPath, F_OK);
        accessSync(fullPath, R_OK);
        accessSync(fullPath, W_OK);
        return true;
    } catch {
        emitLog(ERROR, 'Target File invalid.');
        return false;
    }
};

export const validateJSON = (str: string, schema?: any): jsonValidateResult => {
    const schemaInfo = ajvVdr.compile(schema);
    const beforeValidate: object = (parse(str) as object);
    const valid = schemaInfo(beforeValidate);
    if (!valid) return { err: schemaInfo.errors, result: undefined };
    else return { err: 'passed', result: beforeValidate };
};

export const loadJSONFile = (fullPath: string, schema?: any): object => {
    const { ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    if (!checkFile(fullPath)) {
        emitLog(ERROR, 'File not found, or not accsessable. Process Aborted.');
        throw new EvalError('Target File Error');
    }
    const tgtJSON: jsonValidateResult =
        typeof schema !== 'undefined' ? validateJSON(readFileSync(fullPath, { encoding: 'utf-8' }).toString(), schema)
            : { err: 'passed', result: (parse(readFileSync(fullPath, { encoding: 'utf-8' }).toString()) as object) };
    if (tgtJSON.err !== 'passed' || typeof tgtJSON.result === 'undefined') {
        emitLog(ERROR, `JSON Validation Failed, from File "${fullPath}"`);
        throw new EvalError('JSON Schema Script Cannot Passed');
    }
    emitLog(LOG, `JSON Validation Passed, from File ${fullPath}`);
    return tgtJSON.result;
};

export const saveJSONFile = (jsonObj: any, fullPath: string, schema?: any): void => {
    const { ERROR, WARN, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const check = checkFile(fullPath);
    if (!check) {
        emitLog(ERROR, 'File not found, or not accessable.');
    }
    const jsonStr = stringify(jsonObj, undefined, 4);
    const tgtJSON: jsonValidateResult = typeof schema !== 'undefined' ? validateJSON(jsonStr, schema)
        : { err: 'passed', result: (jsonObj as object) };
    if (tgtJSON.err !== 'passed' || typeof tgtJSON.result === 'undefined') {
        emitLog(ERROR, 'JSON Validation Failed');
        throw new EvalError('JSON Schema Script Cannot Passed');
    }
    emitLog(LOG, 'JSON Validation Passed, Preparing to save to file.');
    if (!check) emitLog(WARN, 'Target File is not found, or not accessable. Testing (re)creating file.');
    writeFileSync(fullPath, jsonStr, { encoding: 'utf-8' });
};
