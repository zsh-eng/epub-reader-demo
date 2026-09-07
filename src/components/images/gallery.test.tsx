import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { click, render } from "../../../tests/dom";
import { imagePersistedDb } from "@/lib/images/db";
import ImagePickerResponsive from "./image-picker-responsive";
import ImagesRoute from "@/routes/ImagesRoute";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });
const imageUrl = "https://images.test/files/gallery-test";
async function seed() {
  const content = new Blob(["image"]);
  await imagePersistedDb.images.put({
    url: imageUrl,
    altText: "Gallery test",
    cachedAt: Date.now(),
    thumbnail: content,
    size: 10,
  });
  await imagePersistedDb.imageBlobs.put({ url: imageUrl, content });
}
async function cleanup() {
  await imagePersistedDb.images.delete(imageUrl);
  await imagePersistedDb.imageBlobs.delete(imageUrl);
}
async function waitForImages() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

test("gallery has native named image buttons and releases thumbnail and preview URLs", async () => {
  await seed();
  const create = spyOn(URL, "createObjectURL");
  const revoke = spyOn(URL, "revokeObjectURL");
  const view = await render(<ImagesRoute />);
  try {
    await waitForImages();
    const button = view.container.querySelector<HTMLButtonElement>(
      'button[aria-label="View image: Gallery test"]',
    )!;
    expect(button.type).toBe("button");
    await click(button);
    await waitForImages();
    expect(
      document.querySelector("#image-dialog")?.getAttribute("src"),
    ).toStartWith("blob:");
    expect(create.mock.results.length).toBeGreaterThanOrEqual(2);
  } finally {
    await view.unmount();
  }
  expect(revoke.mock.calls.length).toBe(create.mock.results.length);
  create.mockRestore();
  revoke.mockRestore();
  await cleanup();
});

test("recent-image clipboard failure keeps picker open for retry", async () => {
  await seed();
  const clipboard = spyOn(
    navigator.clipboard,
    "writeText",
  ).mockRejectedValueOnce(new Error("Clipboard blocked"));
  clipboard.mockResolvedValue(undefined);
  let closes = 0;
  const view = await render(
    <ImagePickerResponsive
      open
      onOpenChange={() => {
        closes++;
      }}
    />,
  );
  try {
    await waitForImages();
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Copy image link: Gallery test"]',
    )!;
    expect(button.type).toBe("button");
    await click(button);
    expect(closes).toBe(0);
    await click(button);
    expect(closes).toBe(1);
  } finally {
    await view.unmount();
    clipboard.mockRestore();
    await cleanup();
  }
});
