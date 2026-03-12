import { Buffer } from 'buffer';
const { from } = Buffer;

export const encryptBinaryStr = (fStr: string): string => {
    const buf = from(fStr, 'utf-8');
    return [...buf].map(byte => byte.toString(2).padStart(8, '0')).join('');
};
