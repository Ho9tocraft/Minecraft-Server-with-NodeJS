import { parseArgs } from "util";
import { coreModuleInitProcess } from "./js/core_process.mjs";
import { MinecraftServerBase } from "./js/minecraft/servers.mjs";
import { join } from "path";

declare global {
    export type rconConstructorOptions = {
        id: number,
        tcp: boolean,
        challenge: boolean
    };
    /**
     * Schedule Info (for GlobalData)
     */
    export type scheduleTimeInfo = {
        motd: string;
        exec: string;
    };
    /**
     * Schedule Info (for Server Data's Override)
     */
    export type scheduleTimeOverrideInfo = {
        doOverride: boolean;
        motd: string;
        exec: string;
    };
    /**
     * Memory Allocation Property (for JVM Args)
     */
    export type JVMMemoryAllocProperty = {
        amount: number;
        unit: string;
    };
    /**
     * Minecraft Server Data (JSON Object)
     */
    export type MinecraftServerData = {
        id: string;
        name: string;
        homeDir: string;
        work: {
            jvmPath: string;
            jvmArgs: {
                memory: {
                    Xmx: JVMMemoryAllocProperty;
                    Xms: JVMMemoryAllocProperty;
                };
                extra: string;
            };
            jarFile: string;
            jarArgs: string;
            proxySocketedSrv: string[] | null;
            rcon: {
                port: number;
                passwdMode: string;
                passwd: string;
            };
        };
        process: {
            runningStatus: string;
            maintenanceMode: boolean;
            scheduleTime: {
                serverExecStart: string;
                override: {
                    dayReboot: scheduleTimeOverrideInfo;
                    weeklyShutdown: scheduleTimeOverrideInfo;
                };
            };
        };
    };
    export type ServerDataJSON = {
        servers: MinecraftServerData[]
    };
    /**
     * rcon.password Decryption First Phase (JSON Object)
     */
    export type RConJSONObject = {
        passphrase: string;
        password: string;
    };
    /**
     * OpenSSL Key and IV (with Decoded Buffer)
     */
    export type OpenSSLKeyAndIV = {
        key: Buffer<ArrayBuffer>;
        iv: Buffer<ArrayBuffer>;
        txt: Buffer<ArrayBuffer>;
    };
    /**
     * Global Data (JSON Object)
     */
    export type GlobalData = {
        version_info: string;
        global_data: {
            mcsRootDir: string;
            maintenanceMode: boolean;
            serverScheduleTime: {
                dayReboot: scheduleTimeInfo;
                weeklyShutdown: scheduleTimeInfo;
                pluginServBuildPull: string;
            };
        };
    };

    export var DEBUG_MODE: boolean;
    export var DEBUG_SERVER_TARGET: string;
    export var MCSERV_CONTROLLER_ENV: {
        /**
         * server_data.json's "servers" property's data
         */
        SERVER_CONFIG_INFO: MinecraftServerData[];
        /**
         * Generated MinecraftServer's Instance Data
         */
        SERVER_INSTANCES: MinecraftServerBase[];
        GLOBAL_CONFIG: GlobalData;
        LOGGING_PREFIXES: {
            DEBUG: string;
            INFO: string;
            LOG: string;
            WARN: string;
            ERROR: string;
            FATAL: string;
        };
        JAVA_VERSION: {
            JDK8: string;
            JDK17: string;
            JDK21: string;
        };
        CONFIG_VALIDATE_INFO: {
            GDJSON_PATH: string;
            SDJSON_PATH: string;
            GDVALIDATE_PATH: string;
            SDVALIDATE_PATH: string;
        };
    };
} (globalThis as any)

const { main, dirname } = import.meta;
type launchOption = {
    'launch-debug': boolean,
    'launchServer': string
};
const launchOptions: any = {
    'launch-debug': {
        type: 'boolean',
        short: 'd'
    },
    'launchServer': {
        type: 'string',
        short: 'S'
    }
};
const args = process.argv.slice(2);

const initGlobalThisVariables = (): void => {
    globalThis.DEBUG_MODE = false;
    globalThis.DEBUG_SERVER_TARGET = '';
    globalThis.MCSERV_CONTROLLER_ENV = {
        SERVER_CONFIG_INFO: [],
        SERVER_INSTANCES: [],
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
            JDK17: '',
            JDK21: ''
        },
        CONFIG_VALIDATE_INFO: {
            GDJSON_PATH: join(dirname, '../data/global_data.json'),
            SDJSON_PATH: join(dirname, '../data/server_data.json'),
            GDVALIDATE_PATH: join(dirname, '../js/validate/schema_global_data.json'),
            SDVALIDATE_PATH: join(dirname, '../js/validate/schema_server_data.json')
        }
    };
};

const runMain = (): number => {
    try {
        coreModuleInitProcess();
        return 0;
    }
    catch (err) {
        console.error(`${globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES.FATAL} MINECRAFT SERVER CONTROLLER catched error: CRITICAL_PROCESS_DIED`);
        console.error(err);
        return 0xdeadc0de;
    }
};

if (main) {
    initGlobalThisVariables();
    const values = (parseArgs({ args, options: launchOptions }).values as launchOption);
    globalThis.DEBUG_MODE = values['launch-debug'];
    globalThis.DEBUG_SERVER_TARGET = values['launchServer'];
    process.exitCode = runMain();
}
