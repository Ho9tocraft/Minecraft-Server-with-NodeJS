'use strict';
import { setTimeout } from 'timers';
import { generateServerInstance, isAccessableNeededFiles, loadGlobalDataJson, loadServerDataJson } from './minecraft/server_inst_rw.mjs';
import { MinecraftServer, searchServerInstance } from './minecraft/server_instance.mjs';

/**
 * サーバー起動処理のデバッグ処理です。
 * @param {MinecraftServer} server デバッグ対象のサーバー
 */
const debugServerProcessing = (server) => {
    server.binPath = 'C:\\Program Files\\RedHat\\java-1.8.0-openjdk-1.8.0.432-1\\bin\\java.exe';
    server.overwriteCurrentWorkingDirectory('F:\\MinecraftServers\\Backup\\Forge1710_Main');
    server.startServer();
    setTimeout(() => {
        server.stopServer();
    }, 20000);
};

/**
 * 初期化時のデバッグコード
 */
const debugCoreModuleInitProcess = () => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { GLOBAL_CONFIG, SERVER_INSTANCES } = MCSERV_CONTROLLER_ENV;
    const debugPrefix = '[DEBUG]';
    if (!DEBUG_MODE) return;
    console.log(`${debugPrefix} Global Data: ${GLOBAL_CONFIG.version_info}\n`);
    SERVER_INSTANCES.forEach((serverInst) => {
        console.log(`${debugPrefix} --- ServerInst Info Begin ---`);
        console.log(`id: ${serverInst.id}`);
        console.log(`name: ${serverInst.name}`);
        console.log(`cwd: ${serverInst.cwd}`);
        console.log(`jvm: ${serverInst.binPath} ${serverInst.binArgs.join(' ')}`);
        console.log(`rcon.port: ${serverInst.rconPort}`);
        console.log(`rcon.password: ${serverInst.rconPasswd}`);
        console.log(`runningStatus: ${serverInst.runningStat} / maintenanceMode: ${serverInst.mayMaintenance}`);
        console.log(`${debugPrefix} --- ServerInst Info End ---\n`);
    });
    const searchResult = searchServerInstance('gregtech');
    if (searchResult.success) debugServerProcessing(SERVER_INSTANCES[searchResult.itr]);
};

/**
 * コアモジュールの初期化プロセスです。
 * @throws なにか異常があると即座になにかしらErrorが投げられる。
 */
export const coreModuleInitProcess = () => {
    if (!isAccessableNeededFiles()) throw EvalError('Needed Files not valid.');
    globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG = loadGlobalDataJson();
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO = loadServerDataJson().servers;
    generateServerInstance();
    debugCoreModuleInitProcess();
};
