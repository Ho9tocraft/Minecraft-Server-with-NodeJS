'use strict';
import { Buffer } from 'buffer';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { decryptEncryptedString } from '../mcsrvcon_utils/decrypt_utils.mjs';
const { parse } = JSON;
const { from, concat } = Buffer;

/**
 * generate openssl decrypt key and iv
 * @param {string} encPasswd
 * @param {string} passphrase
 * @returns {OpenSSLKeyAndIV}
 */
export const outCipherKeyAndIV = (encPasswd, passphrase) => {
    const raw = from(encPasswd, 'base64');
    if (raw.subarray(0, 8).toString('ascii') !== 'Salted__') throw new Error('No OpenSSL salted format');
    const salt = raw.subarray(8, 16);
    const cipherTxt = raw.subarray(16);
    const iter = 10000, digest = 'sha256';
    const keyiv = pbkdf2Sync(
        from(passphrase, 'utf-8'), salt, iter, 48, digest
    );
    return { key: keyiv.subarray(0, 32), iv: keyiv.subarray(32, 48), txt: cipherTxt };
};

/**
 * RCON Password Decrypt Functions
 * @param {string} passwd rcon password
 * @returns {string}
 */
export const decryptRConPasswd = (passwd) => {
    /**
     * @type {RConJSONObject}
     */
    const decryptedJSON = parse(decryptEncryptedString(passwd));
    const passphrase = decryptEncryptedString(decryptedJSON.passphrase);
    const genKeyIv = outCipherKeyAndIV(decryptedJSON.password, passphrase);
    const decipher = createDecipheriv('aes-256-cbc', genKeyIv.key, genKeyIv.iv);
    return decryptEncryptedString(concat([decipher.update(genKeyIv.txt), decipher.final()]).toString().trim());
};
