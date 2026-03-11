import { type as OSType } from 'os';
import { execSync } from 'child_process';
import { checkExec, checkFile } from './json_utils.mjs';

const DirRegExp = /.*(\\|\/)/gi;
const isWin = /windows/i.test(OSType().toString());
const JVMVerRegExp: Readonly<{
    JAVA8: RegExp,
    JAVA17: RegExp,
    JAVA21: RegExp
}> = {
    JAVA8: /^.+ version "1\.8\.0_([0-9]+)"/,
    JAVA17: /^.+ version "17\.[0-9]+\.[0-9]+"/,
    JAVA21: /^.+ version "21\.[0-9]+\.[0-9]+"/
};

type JVMVerInfo = 'JAVA8' | 'JAVA17' | 'JAVA21' | 'INSTALLED_LATEST';

const autoDetectVersionArgs = (runtimeStr: string): string => {
    if (runtimeStr === 'java') return '-version';
    if (runtimeStr === 'python') return '-V';
    if (runtimeStr === 'npm') return '-v';
    throw new ReferenceError('Unsupported Execute file, please report the issue.');
};

const parseVInfo = (vStr: string, options?: { splsct?: string, ovr?: { mvr: number, mjp?: number, mnp?: number } }): { main_v: number, major_patch: number, minor_patch: number } => {
    const inherit = 0xdeadc0de * -1;
    const applyVerInfo = (pVStr: string[]): string[] => {
        const needLoop = 3 - pVStr.length;
        if (needLoop > 0) for (let itr = 0; itr < needLoop; itr++) {
            pVStr.push('0');
        }
        return pVStr;
    };
    const finOpt: Readonly<{ splsct: string, ovr: { mvr: number, mjp: number, mnp: number } }>
        = typeof options !== 'undefined' ? {
            splsct: typeof options.splsct === 'string' ? options.splsct : '.',
            ovr: typeof options.ovr !== 'undefined' ? {
                mvr: typeof options.ovr.mvr === 'number' ? options.ovr.mvr : inherit,
                mjp: typeof options.ovr.mjp === 'number' ? options.ovr.mjp : inherit,
                mnp: typeof options.ovr.mnp === 'number' ? options.ovr.mnp : inherit
            } : { mvr: inherit, mjp: inherit, mnp: inherit }
        } : { splsct: '.', ovr: { mvr: inherit, mjp: inherit, mnp: inherit } };
    const { splsct, ovr } = finOpt;
    const { mvr, mjp, mnp } = ovr;
    const splitVStr = vStr.split(splsct);
    if (mvr !== inherit) splitVStr[0] = `${mvr}`;
    if (mjp !== inherit && splitVStr.length >= 2) splitVStr[1] = `${mjp}`;
    if (mnp !== inherit && splitVStr.length >= 3) splitVStr[2] = `${mnp}`;
    const [mainV, majorP, minorP] = applyVerInfo(splitVStr);
    return {
        main_v: typeof mainV === 'string' ? parseInt(mainV, 10) : 0,
        major_patch: typeof majorP === 'string' ? parseInt(majorP, 10) : 0,
        minor_patch: typeof minorP === 'string' ? parseInt(minorP, 10) : 0
    };
};

const emptyStrFilter = (element: string): boolean => {
    return element !== '' && element.trim() !== '';
};

export const runtimeVersionInfoChecker = (runtimeDir: string, verInfoArg: string): string[] => {
    try {
        return execSync(`"${runtimeDir}" ${verInfoArg} 2>&1`).toString('utf-8').replaceAll('\r', '').split('\n');
    } catch {
        throw new EvalError('VERSION INFO get Failed');
    }
};

export const getJVMVerInfo = (verFlag: string): JVMVerInfo => {
    if (!/(jdk|java)/.test(verFlag)) throw new TypeError('This Flag is not Java');
    if (JVMVerRegExp.JAVA8.test(verFlag)) return 'JAVA8';
    if (JVMVerRegExp.JAVA17.test(verFlag)) return 'JAVA17';
    if (JVMVerRegExp.JAVA21.test(verFlag)) return 'JAVA21';
    return 'INSTALLED_LATEST';
};

export const substrEmu = (str: string, start: number, length: number): string => {
    const end = start + length;
    return str.substring(start, end);
};

export const buildExecBinEnv = (path: string, tgtVer?: string): string => {
    const UnixDirRegExp = /.*\//gi;
    if (isWin) {
        /*
        優先度
        1. C:\+Linux系の実行ファイルのフルパス
        2. 実際のインストールディレクトリ(単体で存在する場合)
        3. 実際のインストールディレクトリ(複数存在する場合)
        */
        let winFilePath = UnixDirRegExp.test(path) ? `C:\\${path.slice(1).replaceAll('/', '\\')}.exe` : path;
        if (!checkFile(winFilePath)) {
            const winExecCmd = winFilePath.replaceAll(DirRegExp, '').replace('.exe', '').trim();
            if (!checkExec(winExecCmd, isWin)) throw new EvalError('Execution Program not found');
            const outResult = execSync(`where ${winExecCmd}`).toString('utf-8').replaceAll('\r', '').split('\n').filter(emptyStrFilter);
            if (outResult.length === 1 && typeof outResult[0] === 'string') winFilePath = outResult[0];
            else {
                if (typeof tgtVer === 'undefined') throw new EvalError('Need Version Select');
                let pickupVerAlternative: { verStr: string, idx: number }[] = [];
                let secondPUVAlternative: { sample: { main_v: number, major_patch: number, minor_patch: number }, idx: number }[] = [];
                outResult.forEach((runtime, idx) => {
                    const verInfo = runtimeVersionInfoChecker(runtime, autoDetectVersionArgs(winExecCmd));
                    let detectVerStr: string = '';
                    verInfo.forEach((vstr) => {
                        if (winExecCmd === 'java' && /^.+ version ".+"/.test(vstr)) detectVerStr = vstr;
                        if (winExecCmd === 'python' && /^Python [0-9]+\.[0-9]+\.[0-9]+/.test(vstr)) detectVerStr = vstr;
                        if (winExecCmd === 'npm' && /^[0-9]+\.[0-9]+\.[0-9]+/.test(vstr)) detectVerStr = vstr;
                    });
                    pickupVerAlternative.push({ verStr: detectVerStr, idx: idx });
                });
                pickupVerAlternative.forEach((sample) => {
                    const { verStr: vAlt, idx } = sample;
                    let defineVAlt: {
                        main_v: number,
                        major_patch: number,
                        minor_patch: number
                    } = {
                        main_v: 0,
                        major_patch: 0,
                        minor_patch: 0
                    };
                    if (winExecCmd === 'java') {
                        const tgtJVM = getJVMVerInfo(vAlt);
                        if (tgtJVM !== tgtVer.replace('JDK', 'JAVA').toUpperCase()) return;
                        switch (tgtJVM) {
                            case 'JAVA8':
                                defineVAlt = parseVInfo(vAlt, { splsct: '_', ovr: { mvr: 8 } });
                                break;
                            case 'JAVA17':
                            case 'JAVA21':
                            case 'INSTALLED_LATEST':
                                defineVAlt = parseVInfo(vAlt);
                                break;
                        }
                    }
                    else defineVAlt = parseVInfo(vAlt);
                    secondPUVAlternative.push({ sample: defineVAlt, idx: idx });
                });
                const latestTgtVerExec: { main_v: number, major_patch: number, minor_patch: number } = {
                    main_v: -10,
                    major_patch: -10,
                    minor_patch: -10
                };
                let destIdx = 0;
                secondPUVAlternative.forEach((tgt, rIdx) => {
                    const { sample } = tgt;
                    const { main_v, major_patch, minor_patch } = sample;
                    if (main_v > latestTgtVerExec.main_v) latestTgtVerExec.main_v = main_v;
                    if (main_v === latestTgtVerExec.main_v
                        && major_patch > latestTgtVerExec.major_patch) latestTgtVerExec.major_patch = major_patch;
                    if (main_v === latestTgtVerExec.main_v && major_patch === latestTgtVerExec.major_patch
                        && minor_patch > latestTgtVerExec.minor_patch) latestTgtVerExec.minor_patch = minor_patch;
                    if (main_v === latestTgtVerExec.main_v && major_patch === latestTgtVerExec.major_patch
                        && minor_patch === latestTgtVerExec.minor_patch) destIdx = rIdx;
                });
                const outResultPUAlt = secondPUVAlternative[destIdx];
                if (typeof outResultPUAlt !== 'undefined') {
                    const destBin = outResult[outResultPUAlt.idx];
                    if (typeof destBin === 'string') winFilePath = destBin;
                }
            }
        }
        return winFilePath;
    }
    else {
        if (!checkExec(path.replaceAll(DirRegExp, '').trim())) throw new EvalError('Program not found');
        if (!checkExec(path.trim(), true)) throw new EvalError('Specific Program not installed');
        return path;
    }
};

/**
 * 
 * @param path File Path
 * @deprecated For Debug
 */
export const testCodeExecBin = (path: string): void => {
    path = isWin ? path.replace('.exe', '').trim() : path;
    const execCmd = path.replaceAll(DirRegExp, '');
    const outResult = execSync(`${isWin ? 'where' : 'which'} ${execCmd}`).toString('utf-8').split('\r\n').filter(emptyStrFilter);
    console.log(outResult);
};
