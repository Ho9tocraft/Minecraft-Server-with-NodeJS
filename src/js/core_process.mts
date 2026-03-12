import { setTimeout } from 'timers';
import { join } from 'path';
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

export const initGlobalThisVariables = (): void => {
    const { dirname } = import.meta;
    globalThis.DEBUG_MODE = false;
    globalThis.DEBUG_SERVER_TARGET = '';
    globalThis.MCSERV_CONTROLLER_ENV = {
        SERVER_CONFIG_INFO: [], // server_data.json
        SERVER_INSTANCES: [], // class MinecraftServerBase
        SRVINST_CACHE: [], // detected server instances
        GLOBAL_CONFIG: {
            version_info: '',
            global_data: {
                mcsRootDir: '',
                maintenanceMode: true,
                serverScheduleTime: {
                    dayReboot: {
                        motd: '',
                        exec: ''
                    },
                    weeklyShutdown: {
                        motd: '',
                        exec: ''
                    },
                    pluginServBuildPull: ''
                }
            }
        },
        LOGGING_PREFIXES: {
            DEBUG: '[DEBUG]',
            INFO: '[INFO]',
            LOG: '[STDOUT]',
            WARN: '[WARN]',
            ERROR: '[ERROR]',
            FATAL: '[FATAL]'
        },
        JAVA_VERSION: {
            JDK8: '/usr/lib/jvm/java-8-openjdk-amd64/bin/java',
            JDK17: '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
            JDK21: '/usr/lib/jvm/java-21-openjdk-amd64/bin/java'
        },
        CONFIG_VALIDATE_INFO: {
            GDJSON_PATH: join(dirname, '../data/global_data.json'),
            SDJSON_PATH: join(dirname, '../data/server_data.json'),
            GDVALIDATE_PATH: join(dirname, '../js/validate/schema_global_data.json'),
            SDVALIDATE_PATH: join(dirname, '../js/validate/schema_server_data.json'),
            SRVINST_CACHE_PATH: join(dirname, '../data/.cache_server.dat')
        }
    };
};
