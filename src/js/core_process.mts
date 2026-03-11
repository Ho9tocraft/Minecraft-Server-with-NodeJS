import { setTimeout } from 'timers';
import { generateServerInstance, MinecraftServerBase, searchServerInstance } from './minecraft/servers.mjs';
import { emitLog } from './general_utils/logger_utils.mjs';
import { isAccessableNeededFiles, loadGlobalDataJSON, loadServerDataJSON } from './minecraft/data_io.mjs';
const { raw } = String;

const debugServerProcessing = (server: MinecraftServerBase): void => {
    server.javaBinPath = raw`C:\Program Files\RedHat\java-1.8.0.432-1\bin\java.exe`;
    server.overwriteCWDir(raw`F:\MinecraftServers\Backup\Forge1710_Main`);
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
