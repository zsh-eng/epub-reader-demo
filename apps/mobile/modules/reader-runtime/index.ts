import { requireNativeModule } from "expo-modules-core";

export interface StagedImport {
  id: string;
  name: string;
  url: string;
}

export default requireNativeModule<{
  start(): Promise<string>;
  stageImport(uri: string, name: string): Promise<StagedImport>;
  finishImport(id: string): Promise<void>;
  pendingImports(): Promise<StagedImport[]>;
}>("ReaderRuntime");
