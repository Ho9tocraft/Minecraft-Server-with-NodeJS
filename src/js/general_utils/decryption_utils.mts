import { Buffer } from 'buffer';
import { TextDecoder } from 'util';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { emitLog } from './logger_utils.mjs';
const { parse } = JSON;
const { from, concat } = Buffer;


const tgtRegExp: Readonly<{
    binary: RegExp,
    hex: RegExp,
    base64: RegExp,
    dangerUTF8: RegExp
}> = {
    binary: /^([01]{8})+$/,
    hex: /^([0-9a-fA-F]{2})+$/,
    base64: /^([0-9a-zA-Z+/]{4})*([0-9a-zA-Z+/]{3}=|[0-9a-zA-Z+/]{2}==)?$/,
    dangerUTF8: /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
};

export const checkHaveDangerUnicode = (test: string): boolean => { return tgtRegExp.dangerUTF8.test(test); };

const isReadableDecryptedStr = (test: string): boolean => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { ERROR, DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    if (test.trim().length === 0) throw new TypeError('Not a string');
    const { hex, base64 } = tgtRegExp;
    const trimedTStr = test.trim();
    let raw: Buffer<ArrayBuffer> | null = null;
    if (hex.test(trimedTStr)) raw = from(trimedTStr, 'hex');
    else if (base64.test(trimedTStr)) raw = from(trimedTStr, 'base64');
    if (raw === null) return false;
    try {
        if (DEBUG_MODE) emitLog(DEBUG, 'Checking Danger Unicode');
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw).trim();
        return !checkHaveDangerUnicode(decoded);
    } catch {
        if (DEBUG_MODE) emitLog(ERROR, 'Test String Have Errored');
        return false;
    }
};

const binaryStrToCharCodeArray = (raw: string): Array<number> => {
    const disassembledArray = raw.match(/.{8}/g);
    if (disassembledArray === null) throw new TypeError('Invalid String');
    return disassembledArray.map(str => parseInt(str, 2));
};

const isBinaryStr = (test: string): boolean => {
    if (test.trim().length === 0) throw new TypeError('Not a string');
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const checkResult = tgtRegExp.binary.test(test.trim());
    if (DEBUG_MODE) emitLog(DEBUG, `Binary Check Result: ${checkResult}`);
    return checkResult
};

const isHexStr = (test: string): boolean => {
    if (test.trim().length === 0) throw new TypeError('Not a string');
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const regExpResult = tgtRegExp.hex.test(test.trim());
    const readableResult = isReadableDecryptedStr(test);
    if (DEBUG_MODE) emitLog(DEBUG, `Hex Check Result: ${regExpResult}, Readable Result: ${readableResult}`);
    return regExpResult && readableResult;
};

const isBase64Str = (test: string): boolean => {
    if (test.trim().length === 0) throw new TypeError('Not a string');
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const regExpResult = tgtRegExp.base64.test(test.trim());
    const readableResult = isReadableDecryptedStr(test);
    if (DEBUG_MODE) emitLog(DEBUG, `Base64 Check Result: ${regExpResult}, Readable Result: ${readableResult}`);
    return regExpResult && readableResult;
};

const isEncryptedStr = (test: string): boolean => {
    return isBinaryStr(test) || isHexStr(test) || isBase64Str(test);
};

const decryptBinStr = (raw: string): { str: string, cond: boolean } => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const trimedRStr = raw.trim();
    if (trimedRStr.length === 0) throw new TypeError('Not a string');
    if (!isBinaryStr(trimedRStr)) {
        if (DEBUG_MODE) emitLog(DEBUG, 'This string is not a BinaryString.');
        return { str: trimedRStr, cond: false };
    }
    return { str: from(binaryStrToCharCodeArray(trimedRStr)).toString('utf-8'), cond: true };
};

const decryptHexStr = (raw: string): { str: string, cond: boolean } => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const trimedRStr = raw.trim();
    if (trimedRStr.length === 0) throw new TypeError('Not a string');
    if (!isHexStr(trimedRStr)) {
        if (DEBUG_MODE) emitLog(DEBUG, 'This string is not a HexString.');
        return { str: trimedRStr, cond: false };
    }
    return { str: from(trimedRStr, 'hex').toString('utf-8'), cond: true };
};

const decryptBase64Str = (raw: string): { str: string, cond: boolean } => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const trimedRStr = raw.trim();
    if (trimedRStr.length === 0) throw new TypeError('Not a string');
    if (!isBase64Str(trimedRStr)) {
        if (DEBUG_MODE) emitLog(DEBUG, 'This string is not a Base64String.');
        return { str: trimedRStr, cond: false };
    }
    return { str: from(trimedRStr, 'base64').toString('utf-8'), cond: true };
};

export const decryptEncryptedStr = (raw: string): string => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG, WARN } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const firstStepRaw = raw.trim();
    if (DEBUG_MODE) emitLog(DEBUG, `Trying Decryption: ${firstStepRaw}`);
    if (firstStepRaw.length === 0) {
        emitLog(WARN, 'This string is empty, decryption skipped.');
        return firstStepRaw;
    }
    if (!isEncryptedStr(firstStepRaw)) {
        emitLog(WARN, `This string is not encrypted, decryption skipped: ${firstStepRaw}`);
        return firstStepRaw;
    }
    let decryptionSample: {
        str: string,
        cond: boolean
    } = {
        str: '',
        cond: false
    };
    let prevStr: string = '';
    let count: number = 1;
    if (DEBUG_MODE) emitLog(DEBUG, `Decryption start: ${firstStepRaw}`);
    do {
        if (DEBUG_MODE) emitLog(DEBUG, `Decryption Lap: ${count}`);
        if (decryptionSample.str.trim().length === 0) decryptionSample.str = firstStepRaw;
        prevStr = decryptionSample.str;
        if (DEBUG_MODE) emitLog(DEBUG, 'PHASE 1: BINARY STRING DECRYPT');
        decryptionSample = decryptBinStr(decryptionSample.str);
        if (DEBUG_MODE) emitLog(DEBUG, `Binary String decryption: cond=${decryptionSample.cond}${decryptionSample.cond ? `,\n  str=${decryptionSample.str}` : ''}`);
        if (!decryptionSample.cond) {
            if (DEBUG_MODE) emitLog(DEBUG, 'PHASE 2: HEX STRING DECRYPT');
            decryptionSample = decryptHexStr(decryptionSample.str);
            if (DEBUG_MODE) emitLog(DEBUG, `Hex String decryption: cond=${decryptionSample.cond}${decryptionSample.cond ? `,\n  str=${decryptionSample.str}` : ''}`);
        }
        if (!decryptionSample.cond) {
            if (DEBUG_MODE) emitLog(DEBUG, 'PHASE 3: BASE64 STRING DECRYPT');
            decryptionSample = decryptBase64Str(decryptionSample.str);
            if (DEBUG_MODE) emitLog(DEBUG, `Base64 String decryption: cond=${decryptionSample.cond}${decryptionSample.cond ? `,\n  str=${decryptionSample.str}` : ''}`);
        }
        if (!isEncryptedStr(decryptionSample.str)) {
            if (DEBUG_MODE) emitLog(DEBUG, 'All Phase of Decryption have been completed, Exiting do-while loop.');
            break;
        }
        count++;
    } while (decryptionSample.str !== prevStr && decryptionSample.cond);
    if (DEBUG_MODE) {
        emitLog(DEBUG, 'Decryption complete.');
        emitLog(DEBUG, '----------------------------');
    }
    return decryptionSample.str;
};

const deployCipherKeyIvTxt = (encPasswd: string, passphrase: string): OpenSSLKeyAndIV => {
    const raw: Buffer<ArrayBuffer> = from(encPasswd, 'base64');
    if (raw.subarray(0, 8).toString('ascii') !== 'Salted__') throw new EvalError('Not a OpenSSL salted format.');
    const salt = raw.subarray(8, 16);
    const cipherTxt = raw.subarray(16);
    const iter = 10000, digest = 'sha256';
    const keyiv = pbkdf2Sync(from(passphrase, 'utf-8'), salt, iter, 48, digest);
    return { key: keyiv.subarray(0, 32), iv: keyiv.subarray(32, 48), txt: cipherTxt };
};

export const decryptRconPasswd = (passwd: string): string => {
    const { password: encPass, passphrase: encPhrase } = parse(decryptEncryptedStr(passwd)) as RConJSONObject;
    const rawPhrase = decryptEncryptedStr(encPhrase);
    const { key, iv, txt } = deployCipherKeyIvTxt(encPass, rawPhrase);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    return decryptEncryptedStr(concat([decipher.update(txt), decipher.final()]).toString().trim());
};
