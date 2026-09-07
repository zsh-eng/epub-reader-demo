import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { render, input } from "../tests/dom";
import ImageUploadDialog from "./image-upload-dialog";
import BlobImage from "./components/images/blob-image";

Object.assign(globalThis, { NodeFilter: window.NodeFilter });

test("upload blocks repeated confirmation, retains description on failure, and releases preview URL", async () => {
  const create = spyOn(URL, "createObjectURL").mockReturnValue(
    "blob:upload-preview",
  );
  const revoke = spyOn(URL, "revokeObjectURL");
  let reject!: (error: Error) => void;
  let calls = 0;
  let attempt = new Promise<void>((_resolve, no) => {
    reject = no;
  });
  const file = new File(["image"], "image.png");
  const props = {
    image: file,
    open: true,
    onSubmit: () => {
      calls++;
      return attempt;
    },
  };
  const view = await render(<ImageUploadDialog {...props} />);
  try {
    const field = document.querySelector<HTMLInputElement>(
      '[aria-label="Image description"]',
    )!;
    await input(field, "My description");
    const form = field.closest("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(calls).toBe(1);
    expect(
      document.querySelector<HTMLButtonElement>(
        'button[aria-label="Upload image and copy link"]',
      )!.disabled,
    ).toBe(true);
    await act(async () => reject(new Error("Could not copy the link")));
    expect(field.value).toBe("My description");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not copy",
    );
    expect(create).toHaveBeenCalledTimes(1);
    attempt = Promise.resolve();
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(calls).toBe(2);
    await view.rerender(<ImageUploadDialog {...props} open={false} />);
    expect(revoke).toHaveBeenCalledWith("blob:upload-preview");
  } finally {
    await view.unmount();
    create.mockRestore();
    revoke.mockRestore();
  }
});

test("blob images reuse their URL on render and revoke it on replacement and unmount", async () => {
  let count = 0;
  const create = spyOn(URL, "createObjectURL").mockImplementation(
    () => `blob:image-${++count}`,
  );
  const revoke = spyOn(URL, "revokeObjectURL");
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  const view = await render(<BlobImage blob={first} alt="First" />);
  try {
    await view.rerender(<BlobImage blob={first} alt="Changed label" />);
    expect(create).toHaveBeenCalledTimes(1);
    await view.rerender(<BlobImage blob={second} alt="Second" />);
    expect(revoke).toHaveBeenCalledWith("blob:image-1");
    expect(view.container.querySelector("img")?.src).toBe("blob:image-2");
  } finally {
    await view.unmount();
  }
  expect(revoke).toHaveBeenCalledWith("blob:image-2");
  create.mockRestore();
  revoke.mockRestore();
});
