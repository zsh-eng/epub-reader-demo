import { createCFamily } from "./c-family";
const highlight = createCFamily("cpp");
export const tokenize = (_options?: { fidelity?: string }) => highlight;
