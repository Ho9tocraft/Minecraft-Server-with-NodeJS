const logLvRegExp: Readonly<{
    ERROR: RegExp,
    WARN: RegExp,
    LOG: RegExp,
    INFO: RegExp
}> = {
    ERROR: /^\[(ERROR|FATAL)\]$/,
    WARN: /^\[WARN\]$/,
    LOG: /^\[(LOG|DEBUG)\]$/,
    INFO: /^\[INFO\]$/
};

export const emitLog = (level: string, str: string, options?: { optStr?: string, optPal?: boolean }): void => {
    const { ERROR, WARN, LOG, INFO } = logLvRegExp;
    options = options || { optStr: '', optPal: true };
    const levelInfo = options.optPal ? `${options.optStr}${level}` : options.optStr;
    const logStr = `${levelInfo} ${str}`;
    if (ERROR.test(level)) console.error(logStr);
    if (WARN.test(level)) console.warn(logStr);
    if (LOG.test(level)) console.log(logStr);
    if (INFO.test(level)) console.info(logStr);
};
