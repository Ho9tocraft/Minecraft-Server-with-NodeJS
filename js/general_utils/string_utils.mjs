
/**
 * 非推奨となったString.substrと同じ結果になるように返却します。
 * @param {string} str 
 * @param {number} start 
 * @param {number} length 
 * @returns emulated String.substr result
 */
export const emuSubStr = (str, start, length) => {
    const end = start + length;
    return str.substring(start, end);
};


