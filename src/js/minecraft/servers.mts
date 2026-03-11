import { ChildProcess, spawn } from 'child_process';
import { TextDecoder } from 'util';
import { Buffer } from 'buffer';
import { setTimeout } from 'timers';
import { checkHaveDangerUnicode, decryptEncryptedStr, decryptRconPasswd } from '../general_utils/decryption_utils.mjs';
import { Rcon } from '../rcon.mjs';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { buildExecBinEnv } from '../general_utils/string_utils.mjs';
import { saveServerDataJSON } from './data_io.mjs';
const { from } = Buffer;

type RunningStatus = 'UNDEFINED' | 'STOPPED' | 'RUNNING' | 'CRASHED';
type searchResultInfo = {
    idx: number;
    name: string;
};

const rconStartedRegExp = /RCON running on/;
const proxyStartedRegExp = /Done \([0-9]+(\.[0-9]*)?s\)!/;

export abstract class MinecraftServerBase {
    currentJSONStat: MinecraftServerData;
    srvId: string;
    srvName: string;
    srvCwd: string;
    javaBinPath: string;
    javaBinArgs: string[];
    proxySocketSrv: string[] | null;
    rconCompatible: boolean;
    rconPort: number;
    rconPasswd: string;
    rconClient: {
        Inst: Rcon | null,
        Auth: boolean,
        QueuedCmds: string[]
    };
    runningStat: RunningStatus;
    runningResult: {
        rStart: boolean,
        rStop: boolean,
        rObserve: boolean
    };
    mayMaintenance: boolean;
    execStart: string;
    scheduleReboot: scheduleTimeInfo;
    scheduleShutdown: scheduleTimeInfo;
    serverProc: ChildProcess | null;
    stopCmd: string;

    // public:
    public constructor(serverJSON: MinecraftServerData) {
        this.currentJSONStat = serverJSON;
        const { id, name, homeDir, work, process } = this.currentJSONStat;
        const { jvmPath, jvmArgs, jarFile, jarArgs, rcon } = work;
        const { Xmx, Xms } = jvmArgs.memory;
        const { port, passwdMode, passwd } = rcon;
        const { runningStatus, maintenanceMode, scheduleTime } = process;
        const { serverExecStart, override } = scheduleTime;
        const { dayReboot, weeklyShutdown } = override;
        const { dayReboot: glbDR, weeklyShutdown: glbWS } = globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG.global_data.serverScheduleTime;
        const tmpDR: Readonly<scheduleTimeInfo> = { motd: dayReboot.motd, exec: dayReboot.exec };
        const tmpWS: Readonly<scheduleTimeInfo> = { motd: weeklyShutdown.motd, exec: weeklyShutdown.exec };

        this.srvId = id;
        this.srvName = this.buildServerName(name);
        this.srvCwd = this.buildCWDir(homeDir);
        this.javaBinPath = buildExecBinEnv(this.buildJVMBinPath(jvmPath));
        this.javaBinArgs = this.buildLaunchCode(this.combineJVMArgs(this.buildMemoryArgs(Xmx, Xms), jvmArgs.extra, jarFile, jarArgs));
        this.proxySocketSrv = null;
        this.rconCompatible = false;
        this.rconPort = port;
        this.rconPasswd = this.buildRconPasswd(passwdMode, passwd);
        this.rconClient = {
            Inst: null,
            Auth: false,
            QueuedCmds: []
        };
        this.runningStat = this.convertToRunningStatus(runningStatus);
        this.runningResult = {
            rStart: false,
            rStop: false,
            rObserve: false
        };
        this.mayMaintenance = maintenanceMode;
        this.execStart = serverExecStart;
        this.scheduleReboot = dayReboot.doOverride ? tmpDR : glbDR;
        this.scheduleShutdown = weeklyShutdown.doOverride ? tmpWS : glbWS;
        this.serverProc = null;
        this.stopCmd = 'stop';
    }
    public rebuildProcProperties(): void {
        const { runningStatus, maintenanceMode, scheduleTime } = this.currentJSONStat.process;
        const { serverExecStart, override } = scheduleTime;
        const { dayReboot, weeklyShutdown } = override;
        const tmpDR: Readonly<scheduleTimeInfo> = { motd: dayReboot.motd, exec: dayReboot.exec };
        const tmpWS: Readonly<scheduleTimeInfo> = { motd: weeklyShutdown.motd, exec: weeklyShutdown.exec };
        if (this.runningStat !== runningStatus) this.runningStat = this.convertToRunningStatus(runningStatus);
        if (this.mayMaintenance !== maintenanceMode) this.mayMaintenance = maintenanceMode;
        if (this.execStart !== serverExecStart) this.execStart = serverExecStart;
        if (!this.compareScheduleInfo(this.scheduleReboot, tmpDR)) this.scheduleReboot = tmpDR;
        if (!this.compareScheduleInfo(this.scheduleShutdown, tmpWS)) this.scheduleShutdown = tmpWS;
        this.writeCurrentJSONProcStat();
    };
    public writeCurrentJSONProcStat(): void {
        const tmpDROR: boolean = this.currentJSONStat.process.scheduleTime.override.dayReboot.doOverride;
        const tmpWSOR: boolean = this.currentJSONStat.process.scheduleTime.override.weeklyShutdown.doOverride;
        this.currentJSONStat.process.runningStatus = this.runningStat;
        this.currentJSONStat.process.maintenanceMode = this.mayMaintenance;
        this.currentJSONStat.process.scheduleTime.serverExecStart = this.execStart;
        this.currentJSONStat.process.scheduleTime.override.dayReboot = this.updateScheduleOverride(this.scheduleReboot, tmpDROR);
        this.currentJSONStat.process.scheduleTime.override.weeklyShutdown = this.updateScheduleOverride(this.scheduleShutdown, tmpWSOR);
        saveServerDataJSON(this.currentJSONStat);
    }
    public overwriteCWDir(pDir: string, pExec?: boolean) {
        if (globalThis.DEBUG_MODE || pExec) this.srvCwd = pDir;
    }
    public startServer(): void {
        this.runningResult.rStop = false;
        const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis
        const { FATAL, WARN, LOG, DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
        if (DEBUG_MODE) emitLog(DEBUG, 'startServer() Called.');
        if (this.serverProc !== null && this.serverProc.exitCode === null) {
            emitLog(FATAL, `The Server Process "${this.srvId}" is already generated!`);
            return;
        }
        this.serverProc = null;
        if (this.runningStat === 'UNDEFINED') emitLog(LOG, `The Server "${this.srvId}" doesn't appear to have been started.`);
        else {
            emitLog(LOG, `The Status of "${this.srvId}" at its prev-startup was ${this.runningStat}`);
            if (this.runningStat === 'CRASHED') {
                emitLog(WARN, `CRASHED!? I'll proceed with startup, considering the issue of crash resolved.`);
            }
            this.runningStat = this.runningStat !== 'STOPPED' ? 'STOPPED' : this.runningStat;
            this.writeCurrentJSONProcStat();
        }
        emitLog(LOG, `The Server Process "${this.srvId}" starting...`);
        this.initServerProc();
    }
    public observeServer(): void {
        this.runningResult.rObserve = true;
        if (this.serverProc === null || this.runningStat !== 'RUNNING') {
            this.runningResult.rObserve = false;
            return;
        }
        if (!(typeof this.serverProc.exitCode === 'undefined' || this.serverProc.exitCode === null)) {
            this.runningResult.rObserve = false;
            return;
        }
    }
    public stopServer(): void {
        const { ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
        this.runningResult.rStart = false;
        if (this.serverProc === null || this.runningStat !== 'RUNNING') emitLog(ERROR, `The Server "${this.srvId}" isn't RUNNING.`);
        else {
            emitLog(LOG, `The Server Process "${this.srvId}" stopping.`);
            this.instantRCONCommand(this.stopCmd);
        }
    }
    public restartServer(): void {
        if (this.serverProc === null || this.runningStat !== 'RUNNING') return;
        this.stopServer();
        this.serverProc.on('exit', () => {
            this.startServer();
        });
    }
    public abstract instantRCONCommand(cmd: string): void;
    public instantStdinCommand(cmd: string): void {
        if (this.serverProc === null || this.runningStat !== 'RUNNING') return;
        if (this.serverProc.stdin === null) return;
        this.serverProc.stdin.write(`${this.commandMessageFixing(cmd)}\r`);
        this.serverProc.stdin.end();
    }
    // protected:
    protected buildServerName(str?: string): string {
        if (typeof str === 'string') {
            const { WARN } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
            try {
                const trimedStr = str.trim();
                if (trimedStr.length !== 0) {
                    const testhead = new TextDecoder('utf-8', { fatal: true }).decode(from(trimedStr, 'utf-8'));
                    if (!checkHaveDangerUnicode(testhead)) return testhead;
                    else emitLog(WARN, 'Input Server Name has Dangerous UTF-8');
                }
            } catch {
                emitLog(WARN, 'Input Server Name has Dangerous UTF-8');
            }
        }
        return this.autoGenerateServerName();
    }
    protected buildCWDir(homeDir: string): string {
        return `${globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG.global_data.mcsRootDir}/${homeDir}`;
    }
    protected autoGenerateServerName(): string {
        const disassStr = this.srvId.trim().split(' ');
        let upperShiftedStr: string[] = [];
        disassStr.forEach((str) => {
            upperShiftedStr.push(`${str.charAt(0).toUpperCase()}${str.slice(1).toLowerCase()}`);
        });
        return upperShiftedStr.join(' ');
    }
    protected autoMaintenanceModeMessage(message: string): string {
        return `${message} Automatic shift to Maintenance Mode.`;
    }
    protected compareScheduleInfo(pFrom: scheduleTimeInfo, pTgt: scheduleTimeInfo): boolean {
        return (pFrom.motd === pTgt.motd) && (pFrom.exec === pTgt.exec);
    }
    protected updateScheduleOverride(settings: scheduleTimeInfo, doOverride: boolean): scheduleTimeOverrideInfo {
        return { doOverride: doOverride, motd: settings.motd, exec: settings.exec };
    }
    protected buildMemoryArgs(Xmx: JVMMemoryAllocProperty, Xms: JVMMemoryAllocProperty) {
        return `-Xmx${Xmx.amount}${Xmx.unit} -Xms${Xms.amount}${Xms.unit}`;
    }
    protected buildJarFileArgs(file: string): string {
        const txtFileSelector = /^@.+\.txt$/;
        return txtFileSelector.test(file) ? file : `-jar ${file}`;
    }
    protected buildJVMBinPath(PorV: string): string {
        if (/^(JAVA|JDK)[0-9]+/i.test(PorV)) {
            const { JDK8, JDK17, JDK21 } = globalThis.MCSERV_CONTROLLER_ENV.JAVA_VERSION;
            const prepareCode = PorV.replace(/JAVA/i, 'JDK');
            if (prepareCode === 'JDK8') return JDK8;
            if (prepareCode === 'JDK17') return JDK17;
            if (prepareCode === 'JDK21') return JDK21;
            throw new EvalError('Unsupported Java Runtime');
        }
        return PorV;
    }
    protected combineJVMArgs(jvmMemory: string, jvmExtra: string, jarFile: string, jarArgs: string): string {
        return `${jvmMemory} ${jvmExtra} ${this.buildJarFileArgs(jarFile)} ${jarArgs}`;
    }
    protected buildLaunchCode(rawArgs: string) {
        return rawArgs.split(' ');
    }
    protected buildRconPasswd(mode: string, word: string): string {
        if (mode === 'plaintext') return decryptEncryptedStr(word);
        else if (/^(default|aes)$/.test(mode)) return decryptRconPasswd(word);
        else return '';
    }
    protected convertToRunningStatus(stat: string): RunningStatus {
        if (stat === 'STOPPED') return 'STOPPED';
        else if (stat === 'RUNNING') return 'RUNNING';
        else if (stat === 'CRASHED') return 'CRASHED';
        else return 'UNDEFINED';
    }
    protected initServerProc(): void {
        const { ERROR, LOG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
        this.serverProc = spawn(this.javaBinPath, this.javaBinArgs, { cwd: this.srvCwd });
        this.serverProc.on('error', () => {
            emitLog(ERROR, this.autoMaintenanceModeMessage(`The Server Process "${this.srvId}" starting up FAILED.`));
            this.runningStat = 'CRASHED';
            this.mayMaintenance = true;
            this.writeCurrentJSONProcStat();
        }).on('exit', (code) => {
            if (code === 0) this.runningStat = 'STOPPED';
            else this.runningStat = 'CRASHED';
            if (this.runningStat === 'CRASHED') {
                emitLog(ERROR, this.autoMaintenanceModeMessage(`The Server Process "${this.srvId}" CRASHED on stopping process.`));
                this.mayMaintenance = true;
            }
            emitLog(LOG, `The Server Process "${this.srvId}" stopped.`);
            this.runningResult.rStop = true;
            this.rconClient.Inst = null;
            this.writeCurrentJSONProcStat();
        });
        this.serverProc.stdout?.on('data', (data) => {
            const dStr: string = typeof data === 'string' ? data
                : (data instanceof Buffer) ? data.toString('utf-8')
                    : `${data}`;
            if (rconStartedRegExp.test(dStr) || (!this.rconCompatible && proxyStartedRegExp.test(dStr))) {
                emitLog(LOG, `The ${!this.rconCompatible ? 'Proxy ' : ''}Server Process "${this.srvId}" starting up SUCCESS.`);
                this.runningStat = 'RUNNING';
                this.runningResult.rStart = true;
                if (this.rconCompatible) this.initRconClient();
                this.writeCurrentJSONProcStat();
            }
        });
    }
    protected initRconClient(): void {
        const { ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
        const rconLog = `[RCON][${this.srvId.toUpperCase()}]`;
        this.rconClient.Inst = new Rcon('localhost', this.rconPort, this.rconPasswd);
        this.rconClient.Inst.on('auth', () => {
            emitLog(LOG, 'RCon Client Authenticated', { optStr: rconLog });
            this.rconClient.Auth = true;
            this.rconClient.QueuedCmds.forEach((cmd) => {
                if (this.rconClient.Inst === null) return;
                this.rconClient.Inst.send(cmd);
                if (cmd === 'stop') {
                    this.rconClient.Inst.disconnect();
                    return;
                }
            });
        }).on('response', (str) => {
            emitLog(LOG, str, { optStr: rconLog });
        }).on('error', (err) => {
            emitLog(ERROR, err, { optStr: rconLog });
        }).on('end', () => {
            emitLog(LOG, 'Connection Closed', { optStr: rconLog });
        });
    }
    protected commandMessageFixing(cmd: string): string {
        return cmd.trim().replaceAll(/(\r|\n|\t)/g, '');
    }
};

export class MinecraftServer extends MinecraftServerBase {
    constructor(serverJSON: MinecraftServerData) {
        super(serverJSON);
        this.rconCompatible = true;
    }
    override instantRCONCommand(cmd: string): void {
        if (this.rconClient.Inst === null) return;
        this.rconClient.QueuedCmds.push(this.commandMessageFixing(cmd));
        this.rconClient.Inst.connect();
        if (cmd !== 'stop') {
            setTimeout(() => {
                if (this.rconClient.Inst === null) return;
                this.rconClient.Inst.disconnect();
            }, 500)
        }
    }
};

export class VelocityServer extends MinecraftServerBase {
    protected socketedServerStat: Map<string, { stat: boolean, reason: string }>;
    constructor(serverJSON: MinecraftServerData) {
        super(serverJSON);
        const { proxySocketedSrv } = serverJSON.work;
        this.stopCmd = 'end';
        this.proxySocketSrv = proxySocketedSrv || [];
        this.socketedServerStat = new Map();
    }
    public override instantRCONCommand(cmd: string): void {
        this.instantStdinCommand(cmd);
    }
    public override observeServer(): void {
        this.runningResult.rObserve = true;
        const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
        const { ERROR, WARN, LOG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
        if (this.serverProc === null || this.runningStat !== 'RUNNING') {
            this.runningResult.rObserve = false;
            return;
        }
        if (!(typeof this.serverProc.exitCode === 'undefined' || this.serverProc.exitCode === null)) {
            this.runningResult.rObserve = false;
            return;
        }
        if (DEBUG_MODE) emitLog(WARN, 'DEBUG MODE enabled. Skipping Result-Based Process Stopping.', { optStr: '[PROXY-SRV]' });
        this.checkProxySocketedServerStatus();
        this.socketedServerStat.forEach((value, key) => {
            const { stat: isOnline, reason: stat } = value;
            emitLog(LOG, `Socketed Server ${key} Status: ${stat}`, { optStr: '[PROXY-SRV]' });
            if (this.runningResult.rObserve && !isOnline) this.runningResult.rObserve = false;
        });
        if (!this.runningResult.rObserve) {
            emitLog(ERROR, 'Some of the socketed server is not Launched.', { optStr: '[PROXY-SRV]' });
            if (!DEBUG_MODE) {
                emitLog(ERROR, 'Stop phase started.', { optStr: '[PROXY-SRV]' });
                this.stopServer();
            }
        }
    }
    protected checkProxySocketedServerStatus(): void {
        const { LOGGING_PREFIXES, SERVER_INSTANCES } = globalThis.MCSERV_CONTROLLER_ENV;
        const { ERROR, WARN } = LOGGING_PREFIXES;
        let tgtServerInstances: MinecraftServerBase[] = [];
        this.proxySocketSrv?.forEach((tgtSrvId) => {
            const { success, result } = searchServerInstance(tgtSrvId);
            if (success) {
                const tgtSrv = SERVER_INSTANCES.at(result.idx);
                if (typeof tgtSrv === 'undefined') {
                    emitLog(WARN, 'Socketed Server not matched.', { optStr: '[PROXY-SRV]' });
                    return;
                }
                tgtServerInstances.push(tgtSrv);
            }
        });
        if (tgtServerInstances.length === 0) {
            emitLog(ERROR, 'Matched Socketed Server nothing.');
            this.runningResult.rObserve = false;
            return;
        }
        tgtServerInstances.forEach((srvInst) => {
            srvInst.observeServer();
            const { srvId, runningResult } = srvInst;
            const observe = runningResult.rObserve;
            this.socketedServerStat.set(srvId, { stat: observe, reason: `Server is ${observe ? 'online' : 'offline'}` });
        });
    }
}

export const generateServerInstance = (): void => {
    const { SERVER_CONFIG_INFO } = globalThis.MCSERV_CONTROLLER_ENV;
    const { INFO } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    SERVER_CONFIG_INFO.forEach((serverJSON) => {
        const { jarArgs } = serverJSON.work;
        if (/velocity|bungeecord|waterfall|lightfall/i.test(jarArgs)) {
            emitLog(INFO, `The Server Instance "${serverJSON.id}" is Proxy Server.`);
            globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.push(new VelocityServer(serverJSON));
        } else {
            emitLog(INFO, `The Server Instance "${serverJSON.id}" is Runner Server (like Forge, Paper, Fabric).`);
            globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.push(new MinecraftServer(serverJSON));
        }
    });
};

export const searchServerInstance = (keyword: string, optIdx?: number): { success: boolean, result: searchResultInfo } => {
    optIdx = optIdx || 0;
    const failedResult = { success: false, result: { idx: -1, name: 'result not matching' } };
    const allSearch = searchMatchedAllServerInstances(keyword);
    if (!allSearch.success || allSearch.result.length === 0) return failedResult;
    const getResult = allSearch.result.at(optIdx);
    if (typeof getResult === 'undefined') return failedResult;
    return { success: allSearch.success, result: getResult };
};

export const searchMatchedAllServerInstances = (keyword: string): { success: boolean, result: searchResultInfo[] } => {
    let detected: searchResultInfo[] = [];
    const regexSearch = new RegExp(keyword, 'i');
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.forEach((srvInst, idx) => {
        const { srvId: id, srvName: name } = srvInst;
        const tmpResultInfo: searchResultInfo = { idx: idx, name: name };
        if (id === keyword) detected.push(tmpResultInfo);
        else if (name === keyword) detected.push(tmpResultInfo);
        else if (regexSearch.test(id)) detected.push(tmpResultInfo);
        else if (regexSearch.test(name)) detected.push(tmpResultInfo);
    });
    return { success: detected.length > 0, result: detected };
};
