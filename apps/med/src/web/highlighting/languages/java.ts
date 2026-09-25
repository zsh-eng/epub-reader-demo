import { createCFamily } from "./c-family";
const highlight = createCFamily("java");
export const tokenize = (_options?: { fidelity?: string }) => highlight;
