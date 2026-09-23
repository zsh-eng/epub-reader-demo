import type { LabRuntimeConfig } from "./runtime";
import type { SyncV2Event } from "@/lib/sync-v2/sync";

export type LabMode = "inspector" | "app";
export type ClientPreset = "empty" | "metadata" | "downloaded" | "position";
export type DomainRow = Record<string, unknown> & {
  id: string;
  isDeleted: boolean;
};
export type DatabaseSnapshot = Record<string, unknown[]>;
export interface ClientInspection {
  rows: Record<string, DomainRow[]>;
  outbox: unknown[];
  files: { id: string; size: number }[];
  materialized: string[];
  state: {
    pullCursor: number;
    hlc: { wallTimeMs: number; counter: number };
    bootstrapped: boolean;
  } | null;
}
export type ClientCommand =
  | { type: "sync" }
  | { type: "pull" }
  | { type: "push" }
  | { type: "checkpoint"; bookId: string; progress: number }
  | { type: "note"; bookId: string; content: string }
  | { type: "delete-note"; bookId: string }
  | { type: "download"; bookId: string };
export interface LabClientEndpoint {
  inspect(): Promise<ClientInspection>;
  command(command: ClientCommand): Promise<void>;
  snapshot(): Promise<DatabaseSnapshot>;
  stop(): Promise<void>;
}
export interface LabEvent {
  id: number;
  time: number;
  client: string;
  kind: string;
  summary: string;
  detail?: unknown;
  key?: string;
}
export interface LabHost {
  connect(id: string): LabRuntimeConfig;
  attach(id: string, endpoint: LabClientEndpoint): void;
  event(
    id: string,
    event: SyncV2Event | { phase: string; outcome: string; key: string },
  ): void;
}
declare global {
  interface Window {
    __syncLabHost?: LabHost;
  }
}
