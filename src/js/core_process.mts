import { join } from 'path';
import { generateServerInstance } from './minecraft/servers.mjs';
import { isAccessableNeededFiles, loadGlobalDataJSON, loadServerDataJSON } from './minecraft/data_io.mjs';
const { dirname } = import.meta;

export const coreModuleInitProcess = (): void => {
  if (!isAccessableNeededFiles()) throw new EvalError('Needed Files not valid.');
  globalThis.MCSERV_CONTROLLER_ENV.GLOBAL_CONFIG = loadGlobalDataJSON();
  globalThis.MCSERV_CONTROLLER_ENV.SERVER_CONFIG_INFO = loadServerDataJSON().servers;
  generateServerInstance();
};

export const initGlobalThisVariables = (): void => {
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
      GDJSON_PATH: join(dirname, '../../data/global_data.json'),
      SDJSON_PATH: join(dirname, '../../data/server_data.json'),
      GDVALIDATE_PATH: join(dirname, '../../js/validate/schema_global_data.json'),
      SDVALIDATE_PATH: join(dirname, '../../js/validate/schema_server_data.json'),
      SRVINST_CACHE_PATH: join(dirname, '../../data/.cache_server.dat')
    }
  };
};
