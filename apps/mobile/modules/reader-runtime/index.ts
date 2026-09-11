import { requireNativeModule } from "expo";

export interface StagedImport {
  id: string;
  name: string;
  url: string;
}

export default requireNativeModule<{
  getAppearance(): string;
  setAppearance(value: string): void;
  getKeepAwake(): boolean;
  setKeepAwake(value: boolean): void;
  start(): Promise<string>;
  stageImport(uri: string, name: string): Promise<StagedImport>;
  finishImport(id: string): Promise<void>;
  pendingImports(): Promise<StagedImport[]>;
}>("ReaderRuntime");
