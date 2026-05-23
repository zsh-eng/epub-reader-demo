import { DEFAULT_PARAGRAPH_SPACING } from "@/lib/pagination-v2";
import type { ReaderSettings } from "@/types/reader.types";
import { resolvePaginatedReaderLayout } from "../hooks/use-paginated-reader-layout";

export interface ReaderDiagnosticProfile {
  name: string;
  container: { width: number; height: number };
  isMobile: boolean;
  settings: ReaderSettings;
  paragraphSpacingFactor: number;
}

export const DEFAULT_READER_DIAGNOSTIC_PROFILE: ReaderDiagnosticProfile = {
  name: "mobile-baseline",
  container: { width: 390, height: 844 },
  isMobile: true,
  settings: {
    fontSize: 16,
    lineHeight: 1.5,
    fontFamily: "iowan",
    theme: "light",
    textAlign: "left",
    contentWidth: "medium",
  },
  paragraphSpacingFactor: DEFAULT_PARAGRAPH_SPACING,
};

export function resolveReaderDiagnosticLayout(
  profile: ReaderDiagnosticProfile = DEFAULT_READER_DIAGNOSTIC_PROFILE,
) {
  return resolvePaginatedReaderLayout({
    stageWidth: profile.container.width,
    stageHeight: profile.container.height,
    isMobile: profile.isMobile,
  });
}
