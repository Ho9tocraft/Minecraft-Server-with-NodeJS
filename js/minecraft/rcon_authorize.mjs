'use strict';
import { Buffer } from 'buffer';
import { createDecipheriv, pbkdf2Sync } from 'crypto';
import { decryptEncryptedString } from '../mcsrvcon_utils/decrypt_utils.mjs';
const { parse } = JSON;
const { from, concat } = Buffer;

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
 * @typedef {object} RConJSONObject
 * @property {string} passphrase
 * @property {string} password
 */
/**
 * @typedef {object} OpenSSLKeyAndIV
 * @property {string} key
 * @property {string} iv
 * @property {Buffer<ArrayBuffer>} txt
 */

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
 * @param {MinecraftServerData} srvData Server Data (JSON)
 * @returns {string}
 */
export const decryptRConPasswd = (srvData) => {
    const { passwdMode: mode, passwd } = srvData.work.rcon;
    if (mode === 'plaintext') return passwd; // Deprecated mode, Using Default(Multiple Encrypted) Mode
    else {
        /**
         * @type {RConJSONObject}
         */
        const decryptedJSON = parse(decryptEncryptedString(passwd));
        const passphrase = decryptEncryptedString(decryptedJSON.passphrase);
        const genKeyIv = outCipherKeyAndIV(decryptedJSON.password, passphrase);
        const decipher = createDecipheriv('aes-256-cbc', genKeyIv.key, genKeyIv.iv);
        return decryptEncryptedString(concat([decipher.update(genKeyIv.txt), decipher.final()]).toString().trim());
    }
};
