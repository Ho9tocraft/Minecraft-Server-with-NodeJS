const logLvRegExp: Readonly<{
    ERROR: RegExp,
    WARN: RegExp,
    LOG: RegExp,
    INFO: RegExp
}> = {
    ERROR: /^\[(ERROR|FATAL)\]$/i,
    WARN: /^\[WARN\]$/i,
    LOG: /^\[(STDOUT|DEBUG)\]$/i,
    INFO: /^\[INFO\]$/i
};

export const emitLog = (level: string, str: string, options?: Readonly<{ optStr?: string, optPal?: boolean }>): void => {
    const { ERROR, WARN, LOG, INFO } = logLvRegExp;
    const finalOpt: Readonly<{
        optStr: string,
        optPal: boolean
    }> = typeof options === 'undefined' ? { optStr: '', optPal: true } :
        { optStr: (typeof options.optStr === 'undefined' || options.optStr.length === 0) ? '' : options.optStr,
            optPal: typeof options.optPal === 'undefined' ? true : options.optPal };
    const levelInfo = (finalOpt.optStr.length === 0 && !finalOpt.optPal) ? ''
        : `${finalOpt.optPal ? `${finalOpt.optStr}${level}` : finalOpt.optStr}: `;
    const logStr = `${levelInfo}${str}`;
    if (ERROR.test(level)) console.error(logStr);
    if (WARN.test(level)) console.warn(logStr);
    if (LOG.test(level)) console.log(logStr);
    if (INFO.test(level)) console.info(logStr);
};
