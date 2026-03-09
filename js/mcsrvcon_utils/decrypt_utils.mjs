'use strict';
import { Buffer } from 'buffer';
import { daleChall } from 'dale-chall';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDecoder } from 'util';
const { dirname } = import.meta;
const { from } = Buffer;

/**
 * 
 * @param {string} tstr 
 * @returns 
 */
const canMatchBinaryStr = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    return /^([01]{8})+$/.test(tstr.trim());
};
/**
 * 
 * @param {string} tstr 
 * @returns 
 */
const detectHexspeak = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    let detect = false;
    const hexspeakDefinedList = readFileSync(join(dirname, '../../data/excluding_hexspeak.txt'), { encoding: 'utf-8' }).split('\n');
    hexspeakDefinedList.forEach((hexspeakWord) => {
        if (hexspeakWord.trim().toUpperCase() === tstr.trim().toUpperCase()) {
            if (globalThis.DEBUG_MODE) console.log(`[DEBUG] HEXSPEAK DETECTORS MATCHED: ${tstr.trim()}`);
            detect = true;
            return;
        }
        if (hexspeakWord.trim().toLowerCase() === tstr.trim().toLowerCase()) {
            if (globalThis.DEBUG_MODE) console.log(`[DEBUG] HEXSPEAK DETECTORS MATCHED: ${tstr.trim()}`);
            detect = true;
            return;
        }
    });
    return detect;
};
/**
 * 
 * @param {string} tstr 
 * @returns
 */
const detectENWords = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    let detect = false;
    daleChall.forEach((word) => {
        if (word.trim() === tstr.trim().toLowerCase()) {
            if (globalThis.DEBUG_MODE) console.log(`[DEBUG] ENGLISH WORDS DETECTORS MATCHED: ${tstr.trim()}`);
            detect = true;
            return;
        }
    });
    return detect;
};
/**
 * その文字列をデコードしたときに可読可能になるかを検知します。
 * @param {string} tstr テストする文字列。
 * @returns 可読可能の真偽(true/false)
 */
const isReadableDecryptedStr = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    /**
     * @type {Buffer<ArrayBuffer>}
     */
    let raw;
    // Base64 デコードテスト
    if (/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(tstr.trim())) {
        raw = from(tstr.trim(), 'base64');
    }
    // HexString(16進数文字列) デコードテスト
    if (/^([0-9a-fA-F]{2})+$/.test(tstr.trim())) {
        raw = from(tstr.trim(), 'hex');
    }
    try {
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] Decoded string can Readable.');
        return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded);
    } catch {
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] Decoded string cannot Readable.');
        return false;
    }
};
/**
 * 
 * @param {string} tstr 
 * @returns 
 */
const canMatchHexStr = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    return /^([0-9a-fA-F]{2})+$/.test(tstr.trim()) && isReadableDecryptedStr(tstr.trim())
        && !detectENWords(tstr.trim()) && !detectHexspeak(tstr.trim());
};
/**
 * 
 * @param {string} tstr 
 * @returns 
 */
const canMatchBase64Str = (tstr) => {
    if (typeof tstr !== 'string' || (typeof tstr === 'string' && tstr.trim().length === 0)) throw new TypeError('Not String');
    return /^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(tstr.trim()) && isReadableDecryptedStr(tstr.trim())
        && !detectENWords(tstr.trim()) && !detectHexspeak(tstr.trim());
};
/**
 * 
 * @param {string} tstr 
 * @returns 
 */
const canMatchEncryptedStr = (tstr) => {
    return canMatchBinaryStr(tstr) || canMatchHexStr(tstr) || canMatchBase64Str(tstr);
};

/**
 * エンコード形式を確認し、復号を実行してみます。
 * @param {string} raw 変換前の文字列
 * @returns 復号後の文字列。規格が合わない場合、そっくりそのまま返却。
 * @throws 型がstringではない場合、問答無用でTypeError。各関数とは違い、空文字列の場合はそのまま返却する。
 */
export const decryptEncryptedString = (raw) => {
    if (typeof raw !== 'string') throw new TypeError('Not String'); // 型が違うぞバーカ！！
    if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Trying Decryption: ${raw}`);
    if (raw.trim().length === 0) {
        console.warn('[WARN] This string is empty, decryption skipped.');
        return raw; // 空文字列？はいはいそのまま。
    }
    if (!canMatchEncryptedStr(raw)) {
        console.warn(`[WARN] This string is not encrypted, decryption skipped: ${raw}`);
        return raw;
    }
    let decryptedSample = { str: '', cond: false }, prevStr = '';
    let count = 1;
    if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Decryption start: ${raw}`);
    do {
        if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Decryption Lap: ${count}`);
        if (decryptedSample.str.trim().length === 0) decryptedSample.str = raw;
        prevStr = decryptedSample.str;
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] PHASE 1: BINARY STRING DECRYPT');
        decryptedSample = decryptStringBinary(decryptedSample.str);
        if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Binary String decryption: cond=${decryptedSample.cond}${decryptedSample.cond ? `,str=${decryptedSample.str}` : ''}`);
        if (!decryptedSample.cond) {
            if (globalThis.DEBUG_MODE) console.log('[DEBUG] PHASE 2: HEX STRING DECRYPT');
            decryptedSample = decryptStringHex(decryptedSample.str);
            if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Hex String decryption: cond=${decryptedSample.cond}${decryptedSample.cond ? `,str=${decryptedSample.str}` : ''}`);
        }
        if (!decryptedSample.cond) {
            if (globalThis.DEBUG_MODE) console.log('[DEBUG] PHASE 3: BASE64 STRING DECRYPT');
            decryptedSample = decryptStringBase64(decryptedSample.str);
            if (globalThis.DEBUG_MODE) console.log(`[DEBUG] Base64 String decryption: cond=${decryptedSample.cond}${decryptedSample.cond ? `,str=${decryptedSample.str}` : ''}`);
        }
        if (!canMatchEncryptedStr(decryptedSample.str)) {
            if (globalThis.DEBUG_MODE) console.log('[DEBUG] All Phase of Decryption have been completed, Exiting do-while loop.');
            break;
        }
        count++;
    } while (decryptedSample.cond && decryptedSample.str !== prevStr);
    if (globalThis.DEBUG_MODE) console.log('[DEBUG] Decryption complete.');
    if (globalThis.DEBUG_MODE) console.log('----------------------------');
    return decryptedSample.str;
};

/**
 * 2進数文字列(Binary String)を復号します。
 * @param {string} raw 変換前の文字列
 * @returns 復号後の文字列と、変換成功のフラグ。規格が合わない場合、そっくりそのまま返却。
 * @throws 型がstringではない場合、またはstringでも空文字列である場合、問答無用でTypeError。
 */
export const decryptStringBinary = (raw) => {
    if (typeof raw !== 'string' || (typeof raw === 'string' && raw.trim().length === 0)) throw new TypeError('Not String');
    // 8ブロックマッチングをする
    if (!canMatchBinaryStr(raw)) {
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] this string is not a BinaryString.');
        return { str: raw.trim(), cond: false };
    }
    return { str: from(raw.trim().match(/.{8}/g).map(str => parseInt(str, 2))).toString(), cond: true };
};

/**
 * 16進数文字列(Hex String)を復号します。
 * @param {string} raw 変換前の文字列
 * @returns 復号後の文字列と、変換成功のフラグ。規格が合わない場合、そっくりそのまま返却。
 * @throws 型がstringではない場合、またはstringでも空文字列である場合、問答無用でTypeError。
 */
export const decryptStringHex = (raw) => {
    if (typeof raw !== 'string' || (typeof raw === 'string' && raw.trim().length === 0)) throw new TypeError('Not String');
    if (!canMatchHexStr(raw)) {
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] this string is not a HexString.');
        return { str: raw.trim(), cond: false };
    }
    return { str: from(raw.trim(), 'hex').toString(), cond: true };
};

/**
 * Base64文字列を復号します。AES暗号は投げないで下さい(不正な文字列が出力されます)。
 * @param {string} raw 変換前の文字列
 * @returns 復号後の文字列と、変換成功のフラグ。規格が合わない場合、そっくりそのまま返却。
 * @throws 型がstringではない場合、またはstringでも空文字列である場合、問答無用でTypeError。
 */
export const decryptStringBase64 = (raw) => {
    if (typeof raw !== 'string' || (typeof raw === 'string' && raw.trim().length === 0)) throw new TypeError('Not String');
    if (!canMatchBase64Str(raw)) {
        if (globalThis.DEBUG_MODE) console.log('[DEBUG] this string is not a Base64String.');
        return { str: raw.trim(), cond: false };
    }
    return { str: from(raw.trim(), 'base64').toString(), cond: true };
};
