import { MinecraftServer } from '../js/minecraft/server_instance.mjs';
export {};

declare global {
    type rconConstructorOptions = {
        id: number,
        tcp: boolean,
        challenge: boolean
    };
    /**
     * Schedule Info (for GlobalData)
     */
    type scheduleTimeInfo = {
        motd: string;
        exec: string;
    };
    /**
     * Schedule Info (for Server Data's Override)
     */
    type scheduleTimeOverrideInfo = {
        doOverride: boolean;
        motd: string;
        exec: string;
    };
    /**
     * Memory Allocation Property (for JVM Args)
     */
    type JVMMemoryAllocProperty = {
        amount: number;
        unit: string;
    };
    /**
     * Minecraft Server Data (JSON Object)
     */
    type MinecraftServerData = {
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
    /**
     * rcon.password Decryption First Phase (JSON Object)
     */
    type RConJSONObject = {
        passphrase: string;
        password: string;
    };
    /**
     * OpenSSL Key and IV (with Decoded Buffer)
     */
    type OpenSSLKeyAndIV = {
        key: string;
        iv: string;
        txt: Buffer<ArrayBuffer>;
    };
    /**
     * Global Data (JSON Object)
     */
    type GlobalData = {
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

    /**
     * Flag: Debug Mode (--launch-debug / -d)
     */
    var DEBUG_MODE: boolean;
    /**
     * Variables: Minecraft Server Controller Instances and Global Data
     */
    var MCSERV_CONTROLLER_ENV: {
        /**
         * server_data.json's "servers" property's data
         */
        SERVER_CONFIG_INFO: MinecraftServerData[];
        /**
         * Generated MinecraftServer's Instance Data
         */
        SERVER_INSTANCES: MinecraftServer[];
        GLOBAL_CONFIG: GlobalData;
    };
};
