import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  evictLibraryCoverUrl,
  useLibraryCoverUrls,
} from "@/hooks/use-library-cover-urls";
import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files";

const mocks = vi.hoisted(() => ({ hasLocal: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/files", () => ({ files: mocks }));
const fileId = "xxh64:0000000000000001" as FileId;
const books: Book[] = [
  {
    id: "book",
    sourceFileId: "xxh64:0000000000000002" as FileId,
    title: "Local book",
    author: "Author",
    fileSize: 1,
    dateAdded: 1,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    cover: { fileId, blurHash: null },
  },
];

afterEach(() => {
  cleanup();
  evictLibraryCoverUrl(fileId);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockImage(decode: () => Promise<void>) {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:cover");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
}

it("reveals local books while a missing cover is pending, then publishes the decoded cover", async () => {
  const download = Promise.withResolvers<Blob>();
  mocks.hasLocal.mockResolvedValue(false);
  mocks.get.mockReturnValue(download.promise);
  mockImage(() => Promise.resolve());
  const { result } = renderHook(() => useLibraryCoverUrls(books));
  await waitFor(() => expect(result.current.initialCoversReady).toBe(true));
  expect(result.current.coverUrls.has("book")).toBe(false);
  download.resolve(new Blob(["cover"]));
  await waitFor(() =>
    expect(result.current.coverUrls.get("book")).toBe("blob:cover"),
  );
  expect(result.current.initialCoversReady).toBe(true);
});

it("keeps the atomic reveal for covers already stored locally", async () => {
  const decoded = Promise.withResolvers<void>();
  const decode = vi.fn(() => decoded.promise);
  mocks.hasLocal.mockResolvedValue(true);
  mocks.get.mockResolvedValue(new Blob(["cover"]));
  mockImage(decode);
  const { result } = renderHook(() => useLibraryCoverUrls(books));
  await waitFor(() => expect(decode).toHaveBeenCalled());
  expect(result.current.initialCoversReady).toBe(false);
  decoded.resolve();
  await waitFor(() => expect(result.current.initialCoversReady).toBe(true));
  expect(result.current.coverUrls.get("book")).toBe("blob:cover");
});
