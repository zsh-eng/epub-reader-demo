import { expect, test } from "bun:test";
import { act } from "react";
import { click, render } from "../../../tests/dom";
import DownloadAllImages from "./download-all-images";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { resolve, promise };
}

test("batch waits for every image even when its last queued task finishes first", async () => {
  const slow = deferred();
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map([
          ["slow", ""],
          ["fast", ""],
        ])
      }
      download={async (url) => {
        if (url === "slow") await slow.promise;
        return { newlyDownloaded: true };
      }}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    expect(view.container.textContent).toContain("Downloading (1 / 2)");
    expect(view.container.textContent).not.toContain("Downloaded 2");
    await act(async () => slow.resolve());
    expect(view.container.textContent).toContain("Downloaded 2 new images");
  } finally {
    await view.unmount();
  }
});

test("cancel remains terminal after running tasks settle and queued tasks do not start", async () => {
  const pending = deferred();
  let downloads = 0;
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map(Array.from({ length: 7 }, (_, index) => [`image-${index}`, ""]))
      }
      download={async () => {
        downloads++;
        await pending.promise;
        return { newlyDownloaded: true };
      }}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    await click(
      view.container.querySelector(
        'button[aria-label="Cancel image downloads"]',
      )!,
    );
    expect(view.container.textContent).toContain("Download cancelled");
    await act(async () => pending.resolve());
    expect(downloads).toBe(5);
    expect(view.container.textContent).toContain("Download cancelled (5 / 7)");
    expect(view.container.textContent).not.toContain("Downloaded 5");
  } finally {
    await view.unmount();
  }
});

test("a failed batch item is counted and does not reject the whole batch", async () => {
  const view = await render(
    <DownloadAllImages
      findLinks={() =>
        new Map([
          ["bad", ""],
          ["good", ""],
        ])
      }
      download={async (url) => {
        if (url === "bad") throw new Error("Offline");
        return { newlyDownloaded: true };
      }}
    />,
  );
  try {
    await click(view.container.querySelector("button")!);
    expect(view.container.textContent).toContain(
      "Downloaded 1 new images; 1 failed",
    );
  } finally {
    await view.unmount();
  }
});
