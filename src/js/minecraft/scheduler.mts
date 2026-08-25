import cron, { type ScheduledTask } from 'node-cron';
import { emitLog } from '../general_utils/logger_utils.mjs';
import { type MinecraftServerBase } from './servers.mjs';

export type ServerScheduleTaskName = 'start' | 'reboot-motd' | 'reboot-exec' | 'shutdown-motd' | 'shutdown-exec';
export type ServerScheduleTaskSnapshot = Readonly<{
  name: ServerScheduleTaskName,
  expression: string,
  configured: boolean,
  valid: boolean,
  taskStatus: string | null,
  nextRun: string | null,
}>;
export type ServerScheduleSnapshot = Readonly<{
  tasks: readonly ServerScheduleTaskSnapshot[],
  rebootUsesOverride: boolean,
  shutdownUsesOverride: boolean,
}>;

type serverScheduleTask = Readonly<{ name: ServerScheduleTaskName, expression: string, run: () => void }>;

const emitScheduledLog = (serv: MinecraftServerBase, msg: string, isError: boolean = false):void => {
  const { ERROR, LOG } = globalThis.MCSERV_CONTROLLER_ENV.LOGGING_PREFIXES;

  emitLog(isError ? ERROR : LOG, msg, { optStr: `[SCHEDULE][${serv.srvId.toUpperCase()}]` });
};

const runStart = (serv: MinecraftServerBase): void => {
  const { maintenance, processAlive } = serv.getServStatus();

  if (processAlive) {
    emitScheduledLog(serv, 'Scheduled start skipped: Process is already alive.');
    return;
  }
  if (maintenance) {
    emitScheduledLog(serv, 'Scheduled start skipped: Maintenance mode is enabled.');
    return;
  }

  emitScheduledLog(serv, 'Scheduled Start Requested. Starting the server.');
  serv.startServer();
};

const runRebootMotd = (serv: MinecraftServerBase): void => {
  const { maintenance, status } = serv.getServStatus();
  if (status !== 'RUNNING') {
    emitScheduledLog(serv, 'Scheduled reboot warning skipped: Server is not running.');
    return;
  }
  if (maintenance) {
    emitScheduledLog(serv, 'Scheduled reboot warning skipped: Maintenance mode is enabled.');
    return;
  }

  emitScheduledLog(serv, 'Scheduled reboot warning sent.');
  serv.executeConsoleCommands('say [MCSC] Scheduled server restart will be soon.');
};

const runRebootExec = (serv: MinecraftServerBase): void => {
  const { maintenance, status } = serv.getServStatus();
  if (status !== 'RUNNING') {
    emitScheduledLog(serv, 'Scheduled reboot execute skipped: Server is not running.');
    return;
  }
  if (maintenance) {
    emitScheduledLog(serv, 'Scheduled reboot execute skipped: Maintenance mode is enabled.');
    return;
  }

  emitScheduledLog(serv, 'Scheduled reboot execute requested.');
  serv.restartServer();
};

const runShutdownMotd = (serv: MinecraftServerBase): void => {
  if (serv.getServStatus().status !== 'RUNNING') {
    emitScheduledLog(serv, 'Scheduled shutdown warning skipped: Server is not running.');
    return;
  }

  emitScheduledLog(serv, 'Scheduled shutdown warning sent.');
  serv.executeConsoleCommands('say [MCSC] Scheduled server shutdown will be soon.');
};

const runShutdownExec = (serv: MinecraftServerBase): void => {
  if (serv.getServStatus().status !== 'RUNNING') {
    emitScheduledLog(serv, 'Scheduled shutdown execute skipped: Server is not running.');
    return;
  }

  emitScheduledLog(serv, 'Scheduled shutdown execute requested.');
  serv.stopServer();
};

export class ServerScheduleManager {
  protected readonly serverTasks = new Map<string, ScheduledTask[]>();

  public clear(): void {
    for (const serverId of this.serverTasks.keys()) {
      this.remove(serverId);
    }
  }

  public getSnapshot(serv: MinecraftServerBase): ServerScheduleSnapshot {
    const registeredTasks = this.serverTasks.get(serv.srvId);
    const { dayReboot, weeklyShutdown } = serv.currentJSONStat.process.scheduleTime.override;

    const configuredTasks: readonly Readonly<{ name: ServerScheduleTaskName, expression: string }>[] = [
      { name: 'start', expression: serv.execStart },
      { name: 'reboot-motd', expression: serv.scheduleReboot.motd },
      { name: 'reboot-exec', expression: serv.scheduleReboot.exec },
      { name: 'shutdown-motd', expression: serv.scheduleShutdown.motd },
      { name: 'shutdown-exec', expression: serv.scheduleShutdown.exec },
    ];

    const tasks = configuredTasks.map((taskInfo) => {
      const expression = taskInfo.expression.trim();

      if (expression.length === 0) return Object.freeze({
        name: taskInfo.name,
        expression: '',
        configured: false,
        valid: true,
        taskStatus: null,
        nextRun: null
      });

      const valid = cron.validate(expression);

      if (!valid) return Object.freeze({
        name: taskInfo.name,
        expression: expression,
        configured: true,
        valid: false,
        taskStatus: null,
        nextRun: null
      });

      const taskName = `mcsc:${serv.srvId}:${taskInfo.name}`;
      const registeredTask = registeredTasks?.find((task) => { return task.name === taskName }) ?? null;
      const nextRun = registeredTask?.getNextRun() ?? null;

      return Object.freeze({
        name: taskInfo.name,
        expression: expression,
        configured: true,
        valid: true,
        taskStatus: registeredTask?.getStatus() ?? null,
        nextRun: nextRun?.toISOString() ?? null,
      } as ServerScheduleTaskSnapshot);
    });

    return Object.freeze({
      tasks: Object.freeze(tasks),
      rebootUsesOverride: dayReboot.doOverride,
      shutdownUsesOverride: weeklyShutdown.doOverride
    });
  }

  public refresh(serv: MinecraftServerBase): void {
    this.remove(serv.srvId);

    const tasks: readonly serverScheduleTask[] = [
      { name: 'start', expression: serv.execStart, run: () => { runStart(serv); } },
      { name: 'reboot-motd', expression: serv.scheduleReboot.motd, run: () => { runRebootMotd(serv); } },
      { name: 'reboot-exec', expression: serv.scheduleReboot.exec, run: () => { runRebootExec(serv); } },
      { name: 'shutdown-motd', expression: serv.scheduleShutdown.motd, run: () => { runShutdownMotd(serv); } },
      { name: 'shutdown-exec', expression: serv.scheduleShutdown.exec, run: () => { runShutdownExec(serv); } },
    ];

    const createdTasks: ScheduledTask[] = [];

    for (const taskInfo of tasks) {
      const expression = taskInfo.expression.trim();
      if (expression.length === 0) continue;

      if (!cron.validate(expression)) {
        emitScheduledLog(serv, `Invalid cron expression, ignored (${taskInfo.name}): ${expression}`, true);
        continue;
      }

      const scheduledTask = cron.schedule(expression, () => {
        try { taskInfo.run(); }
        catch (error) {
          const detail = error instanceof Error ? error.message : String(error);

          emitScheduledLog(serv, `Scheduled task failed (${taskInfo.name}): ${detail}`, true);
        }
      },
      { name: `mcsc:${serv.srvId}:${taskInfo.name}`, noOverlap: true, unref: true });

      createdTasks.push(scheduledTask);

      emitScheduledLog(serv, `Cron task registered (${taskInfo.name}): ${expression}`);
    }

    if (createdTasks.length > 0) this.serverTasks.set(serv.srvId, createdTasks);

    serv.emit('schedule-status', this.getSnapshot(serv));
  }

  public remove(serverId: string): void {
    const tasks = this.serverTasks.get(serverId);
    if (typeof tasks === 'undefined') return;

    this.serverTasks.delete(serverId);

    for(const task of tasks) {
      task.stop();
      task.destroy();
    }
  }

  public replaceAll(servers: readonly MinecraftServerBase[]): void {
    this.clear();

    for (const serv of servers) {
      this.refresh(serv);
    }
  }
}

export const SSMan = new ServerScheduleManager();
