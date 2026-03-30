import { PaginationEngine } from "./pagination-engine";
import type { PaginationCommand } from "./engine-types";

const engine = new PaginationEngine((event) => postMessage(event));

self.onmessage = (e: MessageEvent<PaginationCommand>) => {
  engine.handleCommand(e.data);
};
