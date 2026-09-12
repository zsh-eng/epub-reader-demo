import { useEffect, useEffectEvent } from "react";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { focusManager, useQueryClient } from "@tanstack/react-query";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import { markEpubPreparationReady } from "@/hooks/use-epub-processor";
import { setNativeActive } from "./lifecycle";
import { isNativeApp, postNative } from "./runtime";
import { readNativeAppearance } from "./appearance";

/** Only small commands cross the bridge. EPUB bytes are fetched from the
 * app's private loopback origin and use the existing transactional import path.
 * Acknowledgement follows committed import, so interrupted imports can retry.
 */
export function NativeBridge() {
  const queryClient = useQueryClient();
  const { appearanceMode, setAppearanceMode } = useReaderSettings();
  const toggleAppearance = useEffectEvent(() => {
    setAppearanceMode(
      appearanceMode === "light"
        ? "dark"
        : appearanceMode === "dark"
          ? "system"
          : "light",
    );
  });
  useEffect(() => {
    if (!isNativeApp) return;
    const importing = new Set<string>();
    const receive = async (event: Event) => {
      const message: unknown = (event as MessageEvent).data;
      if (
        !message ||
        typeof message !== "object" ||
        !("version" in message) ||
        message.version !== 1 ||
        !("type" in message)
      )
        return;
      if (message.type === "toggle-appearance") {
        toggleAppearance();
        return;
      }
      if (
        message.type === "search" &&
        "query" in message &&
        typeof message.query === "string"
      ) {
        window.dispatchEvent(
          new CustomEvent("reader-native-search", { detail: message.query }),
        );
        return;
      }
      if (
        message.type === "lifecycle" &&
        "active" in message &&
        typeof message.active === "boolean"
      ) {
        setNativeActive(message.active);
        focusManager.setFocused(message.active);
        if (message.active) requestAnimationFrame(reportTheme);
        return;
      }
      if (
        message.type !== "import" ||
        !("id" in message) ||
        typeof message.id !== "string" ||
        !("name" in message) ||
        typeof message.name !== "string" ||
        !("url" in message) ||
        typeof message.url !== "string"
      )
        return;
      if (!/^[0-9a-f-]{36}$/i.test(message.id) || importing.has(message.id))
        return;
      const url = new URL(message.url, location.origin);
      if (
        url.origin !== location.origin ||
        url.pathname !== `/native-import/${message.id}`
      )
        return;
      importing.add(message.id);
      try {
        const response = await fetch(url);
        if (!response.ok)
          throw new Error(
            "The selected file is no longer available. Select it again.",
          );
        const file = new File([await response.blob()], message.name, {
          type: "application/epub+zip",
        });
        const book = await addBookFromFile(file);
        markEpubPreparationReady(queryClient, book);
        await queryClient.invalidateQueries({ queryKey: ["books"] });
        postNative({
          type: "imported",
          id: message.id,
          bookId: book.id,
          title: book.title,
        });
      } catch (error) {
        if (error instanceof DuplicateBookError) {
          postNative({
            type: "imported",
            id: message.id,
            bookId: error.existingBook.id,
            title: error.existingBook.title,
            duplicate: true,
          });
        } else {
          postNative({
            type: "import-error",
            id: message.id,
            error:
              error instanceof Error
                ? error.message
                : "Could not import this book.",
          });
        }
      } finally {
        importing.delete(message.id);
      }
    };
    const handleMessage = (event: Event) => {
      void receive(event);
    };
    window.addEventListener("reader-native", handleMessage);
    const reportTheme = () => {
      postNative({
        type: "appearance",
        ...readNativeAppearance(),
      });
    };
    const observer = new MutationObserver(reportTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    reportTheme();
    postNative({ type: "ready" });
    return () => {
      observer.disconnect();
      window.removeEventListener("reader-native", handleMessage);
    };
  }, [queryClient]);
  return null;
}
