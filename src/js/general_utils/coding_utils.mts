export const forEachWithBC = (array: any[], cb: (element: any, index: number, array: any[]) => { tBreak?: boolean, tCont?: boolean }) => {
  for (let i = 0; i < array.length; i++) {
    const trigger: { tBreak: boolean, tCont: boolean } = { tBreak: false, tCont: false };
    const { tBreak: rB, tCont: rC } = cb(array[i], i, array);
    trigger.tBreak = rB ? rB : trigger.tBreak;
    trigger.tCont = rC ? rC : trigger.tCont;
    if (trigger.tBreak) break;
    if (trigger.tCont) continue;
  }
};
