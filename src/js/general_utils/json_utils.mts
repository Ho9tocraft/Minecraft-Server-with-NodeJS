import { accessSync, constants, readFileSync, writeFileSync } from 'fs';
import { type as OSType } from 'os';
import { execSync, spawnSync } from 'child_process';
import { Buffer } from 'buffer';
import { Ajv2020 as Ajv, type ErrorObject } from 'ajv/dist/2020.js';
import { emitLog } from './logger_utils.mjs';
import { decryptEncryptedStr } from './decryption_utils.mjs';
import { encryptBinaryStr } from './encryption_utils.mjs';
const { parse, stringify } = JSON;
const { from } = Buffer;
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

export const saveJSONFile = (jsonObj: any, fullPath: string, schema?: any, supress?: boolean): void => {
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
    if (!supress) emitLog(LOG, 'JSON Validation Passed, Preparing to save to file.');
    if (!check) emitLog(WARN, 'Target File is not found, or not accessable. Testing (re)creating file.');
    writeFileSync(fullPath, jsonStr, { encoding: 'utf-8' });
};

export const loadCacheFile = (): void => {
    /*
    キャッシュファイルの形式: .dat(想定)
    暗号化: Base64文字列→2進数文字列→16進数文字列→Base64文字列→(16進数文字列→Base64文字列→2進数文字列→16進数文字列→Base64文字列)(改行付き)
    */
    const { CONFIG_VALIDATE_INFO, LOGGING_PREFIXES } = globalThis.MCSERV_CONTROLLER_ENV;
    const { SRVINST_CACHE_PATH } = CONFIG_VALIDATE_INFO;
    const { WARN, INFO } = LOGGING_PREFIXES;
    globalThis.MCSERV_CONTROLLER_ENV.SRVINST_CACHE = [];
    if (!checkFile(SRVINST_CACHE_PATH)) {
        emitLog(WARN, 'File not found, or not accessable. Testing (re)creating file.');
        writeFileSync(SRVINST_CACHE_PATH, '', 'binary');
    }
    const tgtFile = readFileSync(SRVINST_CACHE_PATH, { encoding: 'binary' }).toString();
    const decArrayedCache = decryptEncryptedStr(tgtFile).replaceAll('\r','').split('\n');
    decArrayedCache.forEach((tgtStr) => {
        const decStr = decryptEncryptedStr(tgtStr);
        if (decStr.trim().length === 0) return;
        if (!/^[!-~]+$/.test(decStr)) throw new EvalError('Invalid Cache');
        globalThis.MCSERV_CONTROLLER_ENV.SRVINST_CACHE.push(decStr);
    });
    emitLog(INFO, `GET CACHE: ${globalThis.MCSERV_CONTROLLER_ENV.SRVINST_CACHE}`);
};

export const writeCacheFile = (): void => {
    const { CONFIG_VALIDATE_INFO, LOGGING_PREFIXES, SRVINST_CACHE } = globalThis.MCSERV_CONTROLLER_ENV;
    const { SRVINST_CACHE_PATH } = CONFIG_VALIDATE_INFO;
    const { WARN } = LOGGING_PREFIXES;
    const srvInstCachesForWrite: string[] = [];

    SRVINST_CACHE.forEach((cache) => {
        if (/^[!-~]+$/.test(cache)) {
            srvInstCachesForWrite.push(from(
                from(encryptBinaryStr(
                    from(from(cache, 'utf-8').toString('base64'), 'utf-8').toString('hex')
                ), 'utf-8').toString('base64'), 'utf-8'
            ).toString('hex'));
        }
    });
    let srvInstCacheForFinalize: string = srvInstCachesForWrite.length > 0 ? from(encryptBinaryStr(
        from(from(srvInstCachesForWrite.join('\n'), 'utf-8').toString('base64'), 'utf-8').toString('hex')
    ), 'utf-8').toString('base64') : '';

    if (!checkFile(SRVINST_CACHE_PATH)) emitLog(WARN, 'File not found, or not accessable. Testing (re)creating file.');
    writeFileSync(SRVINST_CACHE_PATH, srvInstCacheForFinalize, 'binary');
};
