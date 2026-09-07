import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { input, render } from "../../tests/dom";
import CreateFlashcardRoute from "./CreateFlashcardRoute";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });

test("upload and clipboard failures retain preview and retry without uploading a successful image twice", async () => {
  const upload = spyOn(globalThis, "fetch").mockRejectedValueOnce(
    new Error("Upload offline"),
  );
  upload.mockResolvedValue(
    new Response(JSON.stringify({ success: true, fileKey: "uploaded-key" }), {
      headers: { "Content-Type": "application/json" },
    }),
  );
  const clipboard = spyOn(
    navigator.clipboard,
    "writeText",
  ).mockRejectedValueOnce(new Error("Clipboard denied"));
  clipboard.mockResolvedValue(undefined);
  const view = await render(<CreateFlashcardRoute />);
  try {
    const front = view.container.querySelector("textarea")!;
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        items: [
          {
            type: "image/png",
            getAsFile: () => new File(["image"], "image.png"),
          },
        ],
      },
    });
    await act(async () => {
      front.dispatchEvent(paste);
    });
    const description = document.querySelector<HTMLInputElement>(
      '[aria-label="Image description"]',
    )!;
    await input(description, "Description retained");
    const form = description.closest("form")!;
    const submit = async () => {
      await act(async () => {
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      });
    };
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Upload offline",
    );
    expect(description.value).toBe("Description retained");
    expect(upload).toHaveBeenCalledTimes(1);
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "link could not be copied",
    );
    expect(description.value).toBe("Description retained");
    expect(upload).toHaveBeenCalledTimes(2);
    await submit();
    expect(upload).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenCalledTimes(2);
    expect(clipboard).toHaveBeenLastCalledWith(
      expect.stringContaining("![Description retained]"),
    );
    expect(
      document.querySelector('[aria-label="Image description"]'),
    ).toBeNull();
  } finally {
    await view.unmount();
    upload.mockRestore();
    clipboard.mockRestore();
  }
});
