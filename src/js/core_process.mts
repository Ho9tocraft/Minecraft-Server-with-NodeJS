import { setTimeout } from 'timers';
import { generateServerInstance, MinecraftServerBase, searchServerInstance } from './minecraft/servers.mjs';
import { emitLog } from './general_utils/logger_utils.mjs';
import { isAccessableNeededFiles, loadGlobalDataJSON, loadServerDataJSON } from './minecraft/data_io.mjs';
import { checkExec } from './general_utils/json_utils.mjs';

const debugServerProcessing = (server: MinecraftServerBase): void => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    const { DEBUG } = MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;
    server.overwriteCWDir('F:\\MinecraftServers\\Backup\\Forge1710_Main');
    if (DEBUG_MODE) {
        const { srvId, srvName, srvCwd, javaBinPath } = server;
        const runInfo = [
            '--- Target ServerInst Info Begin ---',
            `Id: ${srvId}`,
            `Name: ${srvName}`,
            `CWD: ${srvCwd}`,
            `JVMBin: ${javaBinPath}`
        ];
        emitLog(DEBUG, runInfo.join('\n'));
        emitLog(DEBUG, '--- Target ServerInst Info End ---')
    }

    server.startServer();
    setTimeout(() => {
        server.stopServer();
    }, 20000);
};

const debugCoreModuleInitProcess = (): void => {
    const { DEBUG_MODE, MCSERV_CONTROLLER_ENV } = globalThis;
    if (!DEBUG_MODE) return;
    const { GLOBAL_CONFIG, SERVER_INSTANCES, LOGGING_PREFIXES } = MCSERV_CONTROLLER_ENV;
    const { DEBUG } = LOGGING_PREFIXES;
    emitLog(DEBUG, `Global Data: ${GLOBAL_CONFIG.version_info}\n`);
    SERVER_INSTANCES.forEach((serverInst) => {
        const { srvId, srvName, srvCwd, javaBinPath, javaBinArgs, rconPort, rconPasswd, runningStat, mayMaintenance } = serverInst;
        const instInfo = [
            '--- ServerInst Info Begin ---',
            `Id: ${srvId}`,
            `Name: ${srvName}`,
            `CWD: ${srvCwd}`,
            `JVM: ${javaBinPath} ${javaBinArgs.join(' ')}`,
            `rcon.port: ${rconPort}`,
            `rcon.password: ${rconPasswd}`,
            `runningStatus: ${runningStat} / maintenanceMode: ${mayMaintenance}`
        ];
        emitLog(DEBUG, instInfo.join('\n'));
        emitLog(DEBUG, '--- ServerInst Info End ---\n');
    });
    let searchResult = searchServerInstance('gregtech');
    if (searchResult.success && typeof searchResult.result !== 'undefined') {
        const { idx } = searchResult.result;
        const getInst = SERVER_INSTANCES.at(idx);
        if (typeof getInst === 'undefined') return;
        debugServerProcessing(getInst);
    }
};

export const coreModuleInitProcess = (): void => {
    if (!isAccessableNeededFiles()) throw new EvalError('Needed Files not valid.');
    globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG = loadGlobalDataJSON();
    globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO = loadServerDataJSON().servers;
    generateServerInstance();
    debugCoreModuleInitProcess();
};
