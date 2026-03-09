'use strict';
import { ChildProcess, spawn } from 'child_process';
import { TextDecoder } from 'util';
import { Buffer } from 'buffer';
import { decryptEncryptedString } from '../mcsrvcon_utils/decrypt_utils.mjs';
import { decryptRConPasswd } from './rcon_authorize.mjs';
import { outputDayReboot, outputWeeklyShutdown, saveServerDataJson } from './server_inst_rw.mjs';
import { Rcon } from './rcon.mjs';
import { setTimeout } from 'timers';
const { from } = Buffer;

/**
 * メンテナンスモードに自動で移行するときのエラーメッセージを出力します。
 * @param {string} str 
 * @returns エラーメッセージ
 */
const autoMaintenanceShiftMessage = (str) => {
    return `[ERROR] ${str} Automatic shift Maintenance Mode.`;
};

/**
 * MinecraftServer.idを基に、サーバーネームを出力します。
 * @param {string} str MinecraftServer.id
 * @returns 構築後のサーバーネーム
 */
const autoGenerateServerName = (str) => {
    const disassembledStr = str.trim().split('_');
    /**
     * @type {string[]}
     */
    let upperShiftedStr = [];
    disassembledStr.forEach((value) => {
        upperShiftedStr.push(`${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`);
    });
    return upperShiftedStr.join(' ');
};

export class MinecraftServer {
    /**
     * コンストラクタ
     * @param {MinecraftServerData} serverJSON 
     */
    constructor(serverJSON) {
        this.currentJSONStat = serverJSON;
        const { id, name, homeDir, work, process } = serverJSON;
        const { jvmPath, jvmArgs, jarFile, jarArgs, rcon } = work;
        const { port, passwdMode, passwd } = rcon;
        const { Xmx, Xms } = jvmArgs.memory;
        const { runningStatus, maintenanceMode, scheduleTime } = process;
        const { serverExecStart, override } = scheduleTime;
        const { dayReboot, weeklyShutdown } = override;
        const tDayReboot = { motd: dayReboot.motd, exec: dayReboot.exec };
        const tWeeklyShutdown = { motd: weeklyShutdown.motd, exec: weeklyShutdown.exec };
        this.id = id;
        this.name = this.buildServerName(name);
        this.cwd = this.buildCurrentWorkingDirectory(homeDir);
        this.binPath = jvmPath;
        this.binArgs = this.buildLaunchCode(this.combineJVMArgs(this.buildMemoryArgs(Xmx, Xms), jvmArgs.extra, jarFile, jarArgs));
        this.rconPort = port;
        this.rconPasswd = this.initDecryptRConPasswd(passwdMode, passwd);
        this.runningStat = runningStatus;
        this.mayMaintenance = maintenanceMode;
        this.execStart = serverExecStart;
        this.scheduleReboot = dayReboot.doOverride ? tDayReboot : outputDayReboot();
        this.scheduleShutdown = weeklyShutdown.doOverride ? tWeeklyShutdown : outputWeeklyShutdown();
        this.runProcResult = {
            sStart: false,
            sObserve: false,
            sStop: false
        };
        /**
         * @type {ChildProcess}
         */
        this.serverProcess = null;
        /**
         * @type {{Inst: Rcon, Auth: boolean, queuedCmds: string[]}}
         */
        this.rconClient = {
            Inst: new Rcon('localhost', this.rconPort, this.rconPasswd),
            Auth: false,
            queuedCmds: []
        };
        const rconLog = `[RCON][${this.id.toUpperCase()}]`;
        this.rconClient.Inst.on('auth', () => {
            console.log(`[SYSOUT]${rconLog} RCon Client Authenticated`);
            this.rconClient.Auth = true;
            this.rconClient.queuedCmds.forEach((cmd) => {
                this.rconClient.Inst.send(cmd);
            });
            this.rconClient.queuedCmds = [];
        }).on('response', (str) => {
            console.log(`${rconLog} Response: ${str}`);
        }).on('error', (err) => {
            console.error(`${rconLog} Error detected: ${err}`);
        }).on('end', () => {
            console.log(`${rconLog} Connection Closed`);
        });
        this.writeCurrentJSONProcessStat();
    };
    /**
     * currentJSONStatから、プロセスプロパティを再構成します。  
     * ただし、「変更点」がある場合にのみ適用されます。
     */
    rebuildProcessProperties() {
        const { runningStatus, maintenanceMode, scheduleTime } = this.currentJSONStat.process;
        const { serverExecStart, override } = scheduleTime;
        const { dayReboot, weeklyShutdown } = override;
        const tDayReboot = { motd: dayReboot.motd, exec: dayReboot.exec };
        const tWeeklyShutdown = { motd: weeklyShutdown.motd, exec: weeklyShutdown.exec };
        if (this.runningStat !== runningStatus) this.runningStat = runningStatus;
        if (this.mayMaintenance !== maintenanceMode) this.mayMaintenance = maintenanceMode;
        if (this.execStart !== serverExecStart) this.execStart = serverExecStart;
        if (this.scheduleReboot.motd !== tDayReboot.motd
            || this.scheduleReboot.exec !== tDayReboot.exec) this.scheduleReboot = tDayReboot;
        if (this.scheduleShutdown.motd !== tWeeklyShutdown.motd
            || this.scheduleShutdown.exec !== tWeeklyShutdown.exec) this.scheduleShutdown = tWeeklyShutdown;
        this.writeCurrentJSONProcessStat();
    };
    /**
     * プロセスプロパティから、currentJSONStatを上書きします。
     */
    writeCurrentJSONProcessStat() {
        this.currentJSONStat.process.runningStatus = this.runningStat;
        this.currentJSONStat.process.maintenanceMode = this.mayMaintenance;
        this.currentJSONStat.process.scheduleTime.serverExecStart = this.execStart;
        this.currentJSONStat.process.scheduleTime.override.dayReboot.motd = this.scheduleReboot.motd;
        this.currentJSONStat.process.scheduleTime.override.dayReboot.exec = this.scheduleReboot.exec;
        this.currentJSONStat.process.scheduleTime.override.weeklyShutdown.motd = this.scheduleShutdown.motd;
        this.currentJSONStat.process.scheduleTime.override.weeklyShutdown.exec = this.scheduleShutdown.exec;
        saveServerDataJson(this.currentJSONStat);
    };
    /**
     * サーバーネームを構築します。
     * @param {string | undefined} str
     * @returns 構築後のサーバーネーム 
     */
    buildServerName(str) {
        if (typeof str === 'string') {
            try {
                const trimedStr = str.trim();
                if (trimedStr.length !== 0) {
                    const testhead = new TextDecoder('utf-8', { fatal: true }).decode(from(trimedStr));
                    if (!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(testhead)) return testhead;
                    else console.warn('[WARN] Input Server Name is Dangerous UTF-8');
                }
            } catch {
                console.warn('[WARN] Input Server Name is Dangerous UTF-8');
            }
        }
        return autoGenerateServerName(this.id);
    }
    /**
     * 起動用のcwdを設定します。
     * @param {string} homeDir Home Directory
     * @returns Current Working Directory (絶対パス)
     */
    buildCurrentWorkingDirectory(homeDir) {
        return `${globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG.global_data.mcsRootDir}/${homeDir}`;
    };
    /**
     * 起動用のcwdを上書きします。  
     * デバッグ用コードであり、通常起動時には使用できません。
     * @param {string} pDir 
     */
    overwriteCurrentWorkingDirectory(pDir) {
        if (globalThis.DEBUG_MODE) this.cwd = pDir;
    };
    /**
     * JVM引数をchild_process.spawnに対応した配列に変換します。
     * @param {string} rawArgs 変換前のJVM引数
     * @returns JVM引数(child_process.spawn用)
     */
    buildLaunchCode(rawArgs) {
        return rawArgs.split(' ');
    };
    /**
     * メモリのJVM引数を構築します。
     * @param {{amount: number, unit: string}} Xmx 最大サイズ
     * @param {{amount: number, unit: string}} Xms 開始サイズ(一種の最小サイズ)
     * @returns メモリのJVM引数
     */
    buildMemoryArgs(Xmx, Xms) {
        return `-Xmx${Xmx.amount}${Xmx.unit} -Xms${Xms.amount}${Xms.unit}`;
    };
    /**
     * JVM引数を完成させます。
     * @param {string} jvmMemory メモリ引数
     * @param {string} jvmExtra メモリ以外のJVM引数
     * @param {string} jarFile 実行用のJARファイル
     * @param {string} jarArgs JARに渡す追加の引数
     * @returns JVM引数(シェルスクリプトや、バッチファイルで使うようなやつ)
     */
    combineJVMArgs(jvmMemory, jvmExtra, jarFile, jarArgs) {
        return `${jvmMemory} ${jvmExtra} -jar ${jarFile} ${jarArgs}`;
    };
    /**
     * rcon.passwordを解読します。
     * @param {string} mode 暗号化方式(plaintext,default/aes)
     * @param {string} word パスワード本体
     * @returns 解読後のパスワード
     */
    initDecryptRConPasswd(mode, word) {
        if (mode === 'plaintext') return decryptEncryptedString(word); // plaintextモードでも、奇特なユーザーが暗号化している可能性を考慮
        else if (/^(default|aes)$/.test(mode)) return decryptRConPasswd(word);
        else return '';
    };
    /**
     * サーバープロセスを起動します。
     */
    startServer() {
        this.runProcResult.sStop = false;
        if (this.serverProcess !== null && this.serverProcess.exitCode === null) {
            console.error(`[FATAL] The Server Process "${this.id}" is already generated!`);
            return;
        }
        this.serverProcess = null;
        if (this.runningStat === 'UNDEFINED') console.log(`[SYSOUT] The Server "${this.id}" doesn't appear to have been started.`);
        else {
            console.log(`[SYSOUT] The Final Status of "${this.id}" at its prev-startup was ${this.runningStat}`);
            if (this.runningStat === 'CRASHED') {
                console.warn(`[WARN] CRASHED!? NO WAY!? I'll proceed with startup, considering the issue of crash resolved.`);
                this.runningStat = 'STOPPED';
                this.writeCurrentJSONProcessStat();
            }
        }
        console.log(`[SYSOUT] The Server Process "${this.id}" starting...`);
        this.serverProcess = spawn(this.binPath, this.binArgs, { cwd: this.cwd });
        this.serverProcess.on('error', () => {
            console.error(autoMaintenanceShiftMessage(`The Server Process "${this.id}" starting up FAILED.`));
            this.runningStat = 'CRASHED';
            this.mayMaintenance = true;
        });
        this.serverProcess.stdout.on('data', (data) => {
            const dataStr = typeof data === 'string' ? data
                : (typeof data === 'object' && data instanceof Buffer) ? data.toString('utf-8')
                    : `${data}`;
            if (/RCON running on/.test(dataStr)) {
                console.log(`[SYSOUT] The Server Process "${this.id}" starting up SUCCESS.`);
                this.runningStat = 'RUNNING';
                this.runProcResult.sStart = true;
                this.writeCurrentJSONProcessStat();
            }
        });
    }
    /**
     * プロセスの生存を確認します。
     */
    observeServer() {
        this.runProcResult.sObserve = true;
        if (this.serverProcess === null || this.runningStat !== 'RUNNING') {
            this.runProcResult.sObserve = false;
            return;
        }
        this.serverProcess.on('exit', (code) => {
            if (code !== 0) {
                console.error(autoMaintenanceShiftMessage(`The Server Process "${this.id}" CRASHED.`));
                this.runningStat = 'CRASHED';
                this.mayMaintenance = true;
                this.runProcResult.sObserve = false;
                this.writeCurrentJSONProcessStat();
            }
        });
    };
    /**
     * サーバープロセスを終了させます。
     */
    stopServer() {
        if (this.serverProcess === null || this.runningStat !== 'RUNNING') {
            console.error(`[ERROR] The Server Process "${this.id}" is not RUNNING`);
        } else {
            console.log(`[SYSOUT] The Server Process "${this.id}" stopping.`);
            //this.instantStdinCommanding('stop');
            this.instantRConCommanding('stop');
            this.serverProcess.on('exit', (code) => {
                if (code === 0) this.runningStat = 'STOPPED';
                else this.runningStat = 'CRASHED';
                if (this.runningStat === 'CRASHED') {
                    console.error(autoMaintenanceShiftMessage(`The Server Process "${this.id}" CRASHED on stopping process.`));
                    this.mayMaintenance = true;
                }
                console.log(`[SYSOUT] The Server Process "${this.id}" stopped.`);
                this.writeCurrentJSONProcessStat();
                this.rconClient.Inst = null;
                this.runProcResult.sStop = true;
            });
        }
    };
    /**
     * サーバープロセスを再起動します。
     */
    restartServer() {
        this.stopServer();
        this.serverProcess.on('exit', () => {
            this.startServer();
        });
    }
    /**
     * RCon経由で、一瞬だけコマンドを送信します。
     * @param {string} cmd 
     */
    instantRConCommanding(cmd) {
        this.rconClient.Inst.connect();
        setTimeout(() => {
            this.rconClient.Inst.send(cmd);
            this.rconClient.Inst.disconnect();
        }, 500);
    }
    /**
     * ChildProcess.stdin経由でコマンドを送信します。
     * @param {string} cmd 改行コードを含まないコマンド(含んでいても、自動で消える。)
     */
    instantStdinCommanding(cmd) {
        this.serverProcess.stdin.write(`${cmd.trim().replaceAll(/(\r|\n|\t)/g, '')}\r`);
        this.serverProcess.stdin.end();
    }
};

/**
 * サーバーインスタンスリストから、指定されたキーワードに合致するインスタンスを探します。
 * @param {string} keyword 
 * @returns 結果と、keywordにidまたはsrvNameが合致したサーバーインスタンスのindex
 */
export const searchServerInstance = (keyword) => {
    let detectedIndex = -8;
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.forEach((srvInst, index) => {
        const regexSearch = new RegExp(keyword, 'i');
        if (detectedIndex === -8 && srvInst.id === keyword) detectedIndex = index;
        if (detectedIndex === -8 && srvInst.name === keyword) detectedIndex = index;
        if (detectedIndex === -8 && regexSearch.test(srvInst.id)) detectedIndex = index;
        if (detectedIndex === -8 && regexSearch.test(srvInst.name)) detectedIndex = index;
        if (detectedIndex !== -8) return;
    });
    if (detectedIndex === -8) return { success: false, itr: 0xdeadc0de * -1 };
    return { success: true, itr: detectedIndex };
};
