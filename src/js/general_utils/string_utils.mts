export const substrEmu = (str: string, start: number, length: number): string => {
    const end = start + length;
    return str.substring(start, end);
};
