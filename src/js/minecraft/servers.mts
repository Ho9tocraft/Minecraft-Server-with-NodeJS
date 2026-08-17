import { type as OSType } from 'os';
import { ChildProcess, spawn } from 'child_process';
import { TextDecoder } from 'util';
import { Buffer } from 'buffer';
import { setTimeout } from 'timers';
import { readFileSync, existsSync } from 'fs';
import _ from 'lodash';
import { checkHaveDangerUnicode, decryptEncryptedStr, decryptRconPasswd } from '../general_utils/decryption_utils.mjs';
import { Rcon } from '../rcon.mjs';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { buildExecBinEnv } from '../general_utils/string_utils.mjs';
import { saveServerDataJSON } from './data_io.mjs';
import { loadCacheFile, writeCacheFile } from '../general_utils/json_utils.mjs';
import { StringDecoder } from 'string_decoder';
import { join } from 'path';
const { from } = Buffer;
const { isEqual } = _;
const isWin = /windows/i.test(OSType().toString());

/**
 * UNDEFINED: 未定義 \
 * STOPPED: 起動していない \
 * STARTING: 起動処理中 \
 * RUNNING: 起動中 \
 * CRASHED: 低～中深刻度クラッシュ \
 * FORCE_STOPPED: 強制停止済み \
 * DEPLETED: 高深刻度クラッシュ(強制停止できないなど)
 */
export type RunningStatus = 'UNDEFINED' | 'STOPPED' | 'STARTING' | 'RUNNING' | 'CRASHED' | 'FORCE_STOPPED' | 'DEPLETED';
export type RConConnectionState = 'DISCONNECTED' | 'CONNECTING' | 'AUTHENTICATING' | 'CONNECTED' | 'FBMODE' | 'FAILED';
type LogSource = 'stdout' | 'stderr';
type searchResultInfo = {
  idx: number;
  name: string;
};

const startedRegExp = /Done \([0-9]+(\.[0-9]*)?s\)\u0021/;

export abstract class MinecraftServerBase {
  /**
   * [PROTECTED] Previous MinecraftServerData JSON
   */
  protected prevJSONStat: MinecraftServerData;
  /**
   * [PROTECTED] Request flags of server
   */
  protected requestFlag: {
    /**
     * condition of stop request
     * @default false
     */
    stop: boolean,
    /**
     * conditions of reboot request
     * @default false
     */
    reboot: boolean,
    /**
     * conditions of forced stop
     * @default false
     */
    forcedStop: boolean,
  };
  /**
   * [PROTECTED] Server stop timer
   */
  protected stopTimer: NodeJS.Timeout | null = null;
  /**
   * [PUBLIC] Current MinecraftServerData JSON
   */
  public currentJSONStat: MinecraftServerData;
  /**
   * [PUBLIC] Server ID
   */
  public srvId: string;
  /**
   * [PUBLIC] Server Name
   */
  public srvName: string;
  /**
   * [PUBLIC] Server Current Working Directory
   */
  public srvCwd: string;
  /**
   * [PUBLIC] Java (JVM) Binary Path
   */
  public javaBinPath: string;
  /**
   * [PUBLIC] Java (JVM) Binary Arguments (for child_process.spawn)
   */
  public javaBinArgs: string[];
  /**
   * [PUBLIC] Proxy Socketed Server List
   */
  public proxySocketSrv: string[] | null;
  /**
   * [PUBLIC] RCON Compatibles
   */
  public rconCompatible: boolean;
  /**
   * [PUBLIC] RCON Port
   */
  public rconPort: number;
  /**
   * [PUBLIC] RCON Password (raw)
   */
  public rconPasswd: string;
  /**
   * [PUBLIC] RCON Client
   */
  public rconClient: {
    /**
     * RCON Instance
     * @default null
     */
    Inst: Rcon | null,
    /**
     * RCON Authorized
     * @default false
     */
    Auth: boolean,
    /**
     * RCON Queued Commands
     * @default []
     */
    QueuedCmds: string[],
    /**
     * stdin Fallback mode when RCon is unavailable
     */
    FBMode: boolean,
    CState: RConConnectionState,
    LastError: string | null,
  };
  /**
   * [PUBLIC] Running Status
   * @default 'UNDEFINED'
   */
  public runningStat: RunningStatus;
  /**
   * [PUBLIC] Running Results for WebUI
   */
  public runningResult: {
    /**
     * Result of startServer()
     */
    rStart: boolean,
    /**
     * Result of stopServer()
     */
    rStop: boolean,
    /**
     * Result of observerServer()
     */
    rObserve: boolean
  };
  /**
   * [PUBLIC] Maintenance Mode Switch
   */
  public mayMaintenance: boolean;
  /**
   * [PUBLIC] Server Scheduled Starting Up
   * ONLY CRON STRINGS
   */
  public execStart: string;
  /**
   * [PUBLIC] Server Scheduled Rebooting
   */
  public scheduleReboot: scheduleTimeInfo;
  /**
   * [PUBLIC] Server Scheduled Stopping
   */
  public scheduleShutdown: scheduleTimeInfo;
  /**
   * [PUBLIC] Server Process (ChildProcess)
   */
  public serverProc: ChildProcess | null;
  /**
   * [PUBLIC] Stop Command
   */
  public stopCmd: 'stop' | 'end';

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

    this.prevJSONStat = this.rebuildPrevServerJSON();

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
      QueuedCmds: [],
      FBMode: false,
      CState: 'DISCONNECTED',
      LastError: null
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
    this.requestFlag = {
      forcedStop: false,
      stop: false,
      reboot: false
    };
    this.writeCurrentJSONProcStat(true, true);
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
  public writeCurrentJSONProcStat(force?: boolean, supress?: boolean): void {
    const tmpDROR: boolean = this.currentJSONStat.process.scheduleTime.override.dayReboot.doOverride;
    const tmpWSOR: boolean = this.currentJSONStat.process.scheduleTime.override.weeklyShutdown.doOverride;
    this.currentJSONStat.process.runningStatus = this.runningStat;
    this.currentJSONStat.process.maintenanceMode = this.mayMaintenance;
    this.currentJSONStat.process.scheduleTime.serverExecStart = this.execStart;
    this.currentJSONStat.process.scheduleTime.override.dayReboot = this.updateScheduleOverride(this.scheduleReboot, tmpDROR);
    this.currentJSONStat.process.scheduleTime.override.weeklyShutdown = this.updateScheduleOverride(this.scheduleShutdown, tmpWSOR);
    if (!compareServerJSONInfo(this.prevJSONStat, this.currentJSONStat) || force) {
      saveServerDataJSON(this.currentJSONStat, supress);
      this.prevJSONStat = this.rebuildPrevServerJSON();
    }
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
    else if (this.runningStat === 'DEPLETED') {
      if (this.mayMaintenance) {
        emitLog(FATAL, `DO NOT STARTING UP THIS SERVER!! IT'S DEPLETED!!`);
        return;
      } else {
        emitLog(WARN, `DEPLETED!? AT YOUR OWN RISK!!`);
      }
    }
    else {
      emitLog(LOG, `The Status of "${this.srvId}" at its prev-startup was ${this.runningStat}`);
      if (this.runningStat === 'CRASHED') {
        emitLog(WARN, `CRASHED!? I'll proceed with startup, considering the issue of crash resolved.`);
      }
    }
    this.runningStat = 'STARTING';
    this.writeCurrentJSONProcStat();
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
    if (this.detectCrash()) {
      const { ERROR } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
      emitLog(ERROR, this.autoMaintenanceModeMessage(`The Server Process "${this.srvId}" CRASHED on previous launching.`));
      this.runningStat = 'CRASHED';
      this.mayMaintenance = true;
      this.writeCurrentJSONProcStat();
    }
  }
  public stopServer(): void {
    const { ERROR, WARN, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    this.runningResult.rStart = false;
    if (this.serverProc === null || this.runningStat !== 'RUNNING') {
      emitLog(ERROR, `The Server "${this.srvId}" isn't RUNNING.`);
    }
    else {
      if (this.requestFlag.stop) {
        emitLog(WARN, `The Server Process "${this.srvId}" is already executed stop sequence.`);
        return;
      }
      const prevProc = this.serverProc;
      emitLog(LOG, `The Server Process "${this.srvId}" stopping.`);
      this.requestFlag.stop = true;
      this.runStopTimer(prevProc);
      this.instantRCONCommand(this.stopCmd);
    }
  }
  public restartServer(): void {
    if (this.serverProc === null || this.runningStat !== 'RUNNING') return;
    this.requestFlag.reboot = true;
    this.stopServer();
  }
  public executeConsoleCommands(input: string | readonly string[]): void {
    const { ERROR } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    if (this.serverProc === null || this.runningStat !== 'RUNNING') {
      emitLog(ERROR, `The Server "${this.srvId}" isn't running.`);
      return;
    }

    const rawCmds: string[] = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/\r?\n/) : [];
    if (rawCmds.length === 0) return;

    for (const rawCmd of rawCmds) {
      const cmd = this.commandMessageFixing(rawCmd);
      if (cmd.length === 0) continue;

      if (/^(?:stop|end)$/i.test(cmd)) {
        this.stopServer();
        return;
      }

      this.instantRCONCommand(cmd);
    }
  }
  public disconnectRcon(): void {
    if (!this.rconCompatible || this.rconClient.FBMode) return;

    this.rconClient.Auth = false;
    this.rconClient.CState = 'DISCONNECTED';
    this.rconClient.LastError = null;
    this.rconClient.Inst?.disconnect();
  }

  // protected:
  /**
   * Binds ChildProcess's Outputs.
   * @param stream ChildProcess's stdout/stderr
   * @param source Readable stream type (stdout/stderr)
   */
  protected bindProcessOut(stream: NodeJS.ReadableStream | null, source: LogSource): void {
    if (stream === null) return;

    const decoder = new StringDecoder('utf-8');
    let remaining = '';
    stream.on('data', (chunk: Buffer) => {
      remaining += decoder.write(chunk);

      const lines = remaining.split(/\r?\n/);
      remaining = lines.pop() ?? '';
      for (const line of lines) { this.handleServerLog(source, line); }
    }).on('end', () => {
      const lastLine = `${remaining}${decoder.end()}`.trim();
      if (lastLine.length > 0) this.handleServerLog(source, lastLine);
    });
  }

  /**
   * Handling Server Logs
   * @param source Readable stream type (stdout/stderr)
   * @param line output lines
   */
  protected handleServerLog(source: LogSource, line: string): void {
    const { LOG, ERROR } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const LOGLEVEL: string = source === 'stderr' ? ERROR : LOG;

    emitLog(LOGLEVEL, line, { optStr: `[${this.srvId}][${source.toUpperCase()}]` });

    if (source !== 'stdout' || this.runningStat !== 'STARTING') return;

    if (startedRegExp.test(line)) {
      emitLog(LOG, `The ${!this.rconCompatible ? 'Proxy ' : ''}Server Process "${this.srvId}" starting up success.`);

      this.runningStat = 'RUNNING';
      this.runningResult.rStart = true;
      if (this.rconCompatible) this.initRconClient();
      this.writeCurrentJSONProcStat();
      return;
    }

    if (this.detectCrash(line)) {
      emitLog(ERROR, this.autoMaintenanceModeMessage(`The Server "${this.srvId}" starting up FAILED.`));
      this.runningStat = 'CRASHED';
      this.mayMaintenance = true;
      this.writeCurrentJSONProcStat();
    }
  }

  protected rebuildPrevServerJSON(): MinecraftServerData {
    const { id, name, homeDir, work, process } = this.currentJSONStat;
    const { jvmPath, jvmArgs, jarFile, jarArgs, rcon, proxySocketedSrv } = work;
    const { Xmx, Xms } = jvmArgs.memory;
    const { port, passwdMode, passwd } = rcon;
    const { runningStatus, maintenanceMode, scheduleTime } = process;
    const { serverExecStart, override } = scheduleTime;
    const { dayReboot, weeklyShutdown } = override;
    return {
      id: id,
      name: name,
      homeDir: homeDir,
      work: {
        jvmPath: jvmPath,
        jvmArgs: {
          memory: {
            Xmx: {
              amount: Xmx.amount,
              unit: Xmx.unit
            },
            Xms: {
              amount: Xms.amount,
              unit: Xms.unit
            }
          },
          extra: jvmArgs.extra
        },
        jarFile: jarFile,
        jarArgs: jarArgs,
        proxySocketedSrv: proxySocketedSrv,
        rcon: {
          port: port,
          passwdMode: passwdMode,
          passwd: passwd
        }
      },
      process: {
        runningStatus: runningStatus,
        maintenanceMode: maintenanceMode,
        scheduleTime: {
          serverExecStart: serverExecStart,
          override: {
            dayReboot: {
              doOverride: dayReboot.doOverride,
              motd: dayReboot.motd,
              exec: dayReboot.exec
            },
            weeklyShutdown: {
              doOverride: weeklyShutdown.doOverride,
              motd: weeklyShutdown.motd,
              exec: weeklyShutdown.exec
            }
          }
        }
      }
    };
  }
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
    const disassStr = this.srvId.trim().split('_');
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
    if (!doOverride) return { doOverride: doOverride, motd: '', exec: '' };
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
    if (/(?:FORCE_)?STOPPED/.test(stat)) return 'STOPPED';
    else if (stat === 'STARTING') return 'STARTING';
    else if (stat === 'RUNNING') return 'RUNNING';
    else if (stat === 'CRASHED') return 'CRASHED';
    else if (stat === 'DEPLETED') return 'DEPLETED';
    else return 'UNDEFINED';
  }
  protected initServerProc(): void {
    const { ERROR, WARN, LOG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    this.serverProc = spawn(this.javaBinPath, this.javaBinArgs, { cwd: this.srvCwd, stdio: ['pipe', 'pipe', 'pipe'] });

    this.bindProcessOut(this.serverProc.stdout, 'stdout');
    this.bindProcessOut(this.serverProc.stderr, 'stderr');

    this.serverProc.on('error', () => {
      this.clearStopTimer();
      emitLog(ERROR, this.autoMaintenanceModeMessage(`The Server Process "${this.srvId}" starting up FAILED.`));
      this.serverProc = null;
      this.runningStat = 'CRASHED';
      this.mayMaintenance = true;
      this.writeCurrentJSONProcStat();
    }).on('exit', (code, signal) => {
      const forcedStop = this.requestFlag.forcedStop;

      this.clearStopTimer();
      this.requestFlag.forcedStop = false;
      const gracefulStop = this.requestFlag.stop && code === 0 && signal === null;
      if (this.serverProc !== null) this.serverProc.stdin?.end();

      this.serverProc = null;
      this.rconClient.Inst = null;
      this.rconClient.Auth = false;
      this.requestFlag.stop = false;

      if (forcedStop) {
        emitLog(WARN, `The Server "${this.srvId}"'s Process was force-terminated.`);
        this.runningStat = 'FORCE_STOPPED';
        this.mayMaintenance = false;
        this.runningResult.rStop = true;
      }
      else if (!gracefulStop) {
        emitLog(ERROR,
          this.autoMaintenanceModeMessage(`The Server Process "${this.srvId}" CRASHED on stopping process.`));
        emitLog(ERROR, `The Server Process "${this.srvId}" stopped. Exit Code: ${code}`);
        this.runningStat = 'CRASHED';
        this.mayMaintenance = true;
        this.requestFlag.reboot = false;
      }
      else {
        emitLog(LOG, `The Server Process "${this.srvId}" stopped.`);
        this.runningStat = 'STOPPED';
        this.runningResult.rStop = true;

        if (this.requestFlag.reboot) {
          this.requestFlag.reboot = false;
          emitLog(LOG, `The Server Process "${this.srvId}" has restarting enabled. It'll restart after a delay.`);
          setTimeout(() => { this.startServer(); }, 2000);
        }
      }

      this.writeCurrentJSONProcStat();
    });
  }
  protected initRconClient(): void {
    const { ERROR, WARN, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const rconLog = `[RCON][${this.srvId.toUpperCase()}]`;

    this.rconClient.QueuedCmds = [];
    this.rconClient.FBMode = !this.verifyRconConfig();
    this.rconClient.LastError = null;

    if (this.rconClient.FBMode) {
      this.rconClient.CState = 'FBMODE';
      this.rconClient.LastError = 'INVALID RCON CONFIGURATION detected.';
      emitLog(WARN, 'RCON is not configured. Enable Fallback Mode.', { optStr: rconLog });
      return;
    }

    this.rconClient.CState = 'DISCONNECTED';

    this.rconClient.Inst = new Rcon('localhost', this.rconPort, this.rconPasswd);

    this.rconClient.Inst.on('connect', () => {
      this.rconClient.CState = 'AUTHENTICATING';
    }).on('auth', () => {
      emitLog(LOG, 'RCon Client Authenticated', { optStr: rconLog });
      this.rconClient.Auth = true;
      this.rconClient.CState = 'CONNECTED';
      this.flushCommandQueue();
    }).on('response', (str) => {
      emitLog(LOG, str, { optStr: rconLog });
    }).on('error', (err) => {
      this.rconClient.Auth = false;
      this.rconClient.CState = 'FAILED';
      this.rconClient.LastError = err instanceof Error ? err.message : `${err}`;
      emitLog(ERROR, err, { optStr: rconLog });
      this.enableStdinFBMode();
    }).on('end', () => {
      this.rconClient.Auth = false;
      if (!this.rconClient.FBMode) this.rconClient.CState = 'DISCONNECTED';

      emitLog(LOG, 'Connection Closed', { optStr: rconLog });
    });
  }
  protected verifyRconConfig(): boolean {
    const confValidPort = Number.isInteger(this.rconPort) && this.rconPort > 0 && this.rconPort <= 65535;
    const confValidPasswd = this.rconPasswd.trim().length > 0 && !/^(?:undefined|null)$/i.test(this.rconPasswd);
    if (!confValidPort || !confValidPasswd) return false;

    const propertiesPath = join(this.srvCwd, 'server.properties');
    if (!existsSync(propertiesPath)) return false;

    let rawProperties: string;
    try {
      rawProperties = readFileSync(propertiesPath, { encoding: 'utf-8' });
    } catch {
      return false;
    }
    const properties = new Map<string, string>();
    for (const rawLine of rawProperties.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) continue;

      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 0) continue;

      const key = line.slice(0, separatorIndex).trim(), value = line.slice(separatorIndex + 1);
      properties.set(key, value);
    }

    const rconEnabled = properties.get('enable-rcon');
    const servPortTxt = properties.get('rcon.port');
    const servPasswd = properties.get('rcon.password');

    if (typeof rconEnabled === 'undefined'
      || typeof servPasswd === 'undefined' || typeof servPortTxt === 'undefined') return false;

    const serverPort = Number.parseInt(servPortTxt, 10);

    return rconEnabled.toLowerCase() === 'true'
      && Number.isInteger(serverPort)
      && serverPort >= 1 && serverPort <= 65535
      && serverPort === this.rconPort
      && servPasswd === this.rconPasswd;
  }
  protected enableStdinFBMode(): void {
    if (this.rconClient.FBMode) return;
    const { WARN } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const rconLog = `[RCON][${this.srvId.toUpperCase()}]`;

    this.rconClient.FBMode = true;
    this.rconClient.Auth = false;
    this.rconClient.CState = 'FBMODE';

    if (this.rconClient.LastError === null) this.rconClient.LastError = 'RCON connection failed.';

    this.rconClient.Inst?.disconnect();
    this.rconClient.Inst = null;

    emitLog(WARN, 'RCon Connection Failed. FBMode (Fallback Mode) active.', { optStr: rconLog });

    this.flushCommandQueue();
  }
  protected commandMessageFixing(cmd: string): string {
    return cmd.trim().replaceAll(/(\r|\n|\t)/g, '');
  }
  protected detectCrash(message?: string): boolean {
    const { WARN } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    const crashMessage = /This crash report has been saved to/i;
    const dirCode = isWin ? '\\' : '/';
    const LATEST_LOG = `${this.srvCwd}${dirCode}logs${dirCode}latest.log`;
    if (typeof message === 'string') {
      // 起動中であるはずなので評価
      return crashMessage.test(message);
    }
    if (!existsSync(LATEST_LOG)) {
      // ログが見つかっているわけではないので「クラッシュしたかどうか分からない」、よってreturn false。
      emitLog(WARN, `Couldn't find latest.log file, you haven't even booted it up yet, have you?`);
      return false;
    }
    const file = readFileSync(LATEST_LOG, { encoding: 'utf-8' }).toString();
    return crashMessage.test(file)
  }
  protected abstract instantRCONCommand(cmd: string): void;
  protected instantStdinCommand(cmd: string): void {
    if (this.serverProc === null || this.runningStat !== 'RUNNING') return;
    if (this.serverProc.stdin === null) return;
    this.serverProc.stdin.write(`${this.commandMessageFixing(cmd)}\r`);
  }

  protected clearStopTimer(): void {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
    }
    this.stopTimer = null;
  }
  protected flushCommandQueue(): void {
    const client = this.rconClient.Inst;
    if (this.rconCompatible && !this.rconClient.FBMode) {
      if (client === null || !this.rconClient.Auth) return;

      const cmds = this.rconClient.QueuedCmds.splice(0);
      cmds.forEach((cmd) => client.send(cmd, {}));
      return;
    }

    const cmds = this.rconClient.QueuedCmds.splice(0);
    cmds.forEach((cmd) => this.instantStdinCommand(cmd));
  }

  protected runStopTimer(proc: ChildProcess): void {
    const { FATAL, WARN } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;

    this.clearStopTimer();
    this.stopTimer = setTimeout(() => {
      if (this.serverProc !== proc || proc.exitCode !== null || !this.requestFlag.stop) return;

      this.requestFlag.stop = false;
      this.requestFlag.forcedStop = true;
      this.requestFlag.reboot = false;
      this.runningStat = 'FORCE_STOPPED'; // タイムアウト強制終了はCRASHEDとしては扱わない
      this.mayMaintenance = false;
      this.writeCurrentJSONProcStat();

      emitLog(WARN, `The server "${this.srvId}" didn't stop within 3 minutes. \nForce-terminating!`);
      //TODO: 強制終了コード(終了保証時間の経過であるため)
      try {
        const killed = proc.kill('SIGKILL');

        if (!killed) throw new AggregateError([
          new EvalError('Terminating Signals could not sending!'),
          new Error('Shutdown Error Occured: This server is DEPLETED.')
        ], 'Terminating Signals could not sending, this server is DEPLETED!');
      } catch (err) {
        this.requestFlag.forcedStop = false;
        this.runningStat = 'DEPLETED';
        this.mayMaintenance = true;
        this.writeCurrentJSONProcStat();
        emitLog(FATAL, `FAILED to force-terminate server "${this.srvId}": ${err}\nPlease use root permission console.`);
      }
    }, 180000);
  }
};

export class MinecraftServer extends MinecraftServerBase {
  constructor(serverJSON: MinecraftServerData) {
    super(serverJSON);
    this.rconCompatible = true;
  }
  protected override instantRCONCommand(cmd: string): void {
    const client = this.rconClient.Inst;

    this.rconClient.QueuedCmds.push(this.commandMessageFixing(cmd));

    if (this.rconClient.FBMode || client === null) {
      this.flushCommandQueue();
      return;
    }

    if (!client.isOpen() && this.rconClient.CState !== 'CONNECTING') {
      this.rconClient.CState = 'CONNECTING';
    }

    client.connect();
    this.flushCommandQueue();
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
  protected override instantRCONCommand(cmd: string): void {
    this.instantStdinCommand(cmd);
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

const hasContainServerInstanceCache = (keyword: string): boolean => {
  let result = false;
  const { SRVINST_CACHE } = globalThis.MCSERV_CONTROLLER_ENV;
  SRVINST_CACHE.forEach((cache) => {
    if (result) return;
    if (cache === keyword) result = true;
  });
  return result;
};

const compareServerJSONInfo = (base: MinecraftServerData, comp: MinecraftServerData) => {
  const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
  const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
  /*
  変更可能:
  - name
  - work
    - jvmArgs
      - memory
        - Xmx
         -Xms
      - extra
    - jarFile
    - jarArgs
    - proxySocketedSrv
  - process
    - runningStatus
    - maintenanceMode
    - scheduleTime
      - serverExecStart
      - override
        - dayReboot, weeklyShutdown
          - doOverride
          - motd
          - exec
   */
  type checkJSON = Readonly<{
    name: string,
    work: {
      jvmArgs: {
        memory: {
          Xmx: JVMMemoryAllocProperty,
          Xms: JVMMemoryAllocProperty
        },
        extra: string
      },
      jarFile: string,
      jarArgs: string,
      proxySocketedSrv: string[] | null
    },
    process: {
      runningStatus: string,
      maintenanceMode: boolean,
      scheduleTime: {
        serverExecStart: string,
        override: {
          dayReboot: {
            doOverride: boolean,
            motd: string,
            exec: string
          },
          weeklyShutdown: {
            doOverride: boolean,
            motd: string,
            exec: string
          }
        }
      }
    }
  }>;
  const bJSONTgt: checkJSON = {
    name: base.name,
    work: {
      jvmArgs: base.work.jvmArgs,
      jarFile: base.work.jarFile,
      jarArgs: base.work.jarArgs,
      proxySocketedSrv: base.work.proxySocketedSrv
    },
    process: base.process
  };
  const cJSONTgt: checkJSON = {
    name: comp.name,
    work: {
      jvmArgs: comp.work.jvmArgs,
      jarFile: comp.work.jarFile,
      jarArgs: comp.work.jarArgs,
      proxySocketedSrv: comp.work.proxySocketedSrv
    },
    process: comp.process
  };
  if (DEBUG_MODE) emitLog(DEBUG, `PrevStat: ${bJSONTgt.process.runningStatus} / CurrentStat: ${cJSONTgt.process.runningStatus}`);
  const result = isEqual(bJSONTgt, cJSONTgt);
  if (DEBUG_MODE) emitLog(DEBUG, `Checking server_data.json status [RESULT: ${result}]`);
  return result;
};

export const generateServerInstance = (): void => {
  let detectNotMatch = false;
  loadCacheFile();
  const { SERVER_CONFIG_INFO, SRVINST_CACHE } = globalThis.MCSERV_CONTROLLER_ENV;
  const { INFO, FATAL } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
  SERVER_CONFIG_INFO.forEach((serverJSON) => {
    const { id, work } = serverJSON;
    if (!hasContainServerInstanceCache(id)) serverJSON.process.runningStatus = 'UNDEFINED';
    else if (/(?:RUNN|START)ING/.test(serverJSON.process.runningStatus)) {
      // 冷静に考えれば、RUNNING/STOPPING/STARTINGがこの状況下で動いているわけがないのでこうなる
      serverJSON.process.runningStatus = 'STOPPED';
    }
    const { jarFile } = work;
    if (/velocity|bungeecord|waterfall|lightfall/i.test(jarFile)) {
      emitLog(INFO, `The Server Instance "${serverJSON.id}" is Proxy Server.`);
      globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.push(new VelocityServer(serverJSON));
    } else {
      emitLog(INFO, `The Server Instance "${serverJSON.id}" is Runner Server (like Forge, Paper, Fabric).`);
      globalThis.MCSERV_CONTROLLER_ENV.SERVER_INSTANCES.push(new MinecraftServer(serverJSON));
    }
    SRVINST_CACHE.forEach((cache) => {
      if (!detectNotMatch) detectNotMatch = serverJSON.id === cache;
    });
    if (!detectNotMatch) SRVINST_CACHE.push(serverJSON.id);
    detectNotMatch = false;
  });
  writeCacheFile();
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
