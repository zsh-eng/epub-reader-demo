import { expect, test } from "bun:test";
import { cacheImagesInContainer } from "./cache-container";

async function mutations() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("cache walker handles initial, directly inserted, and nested images and releases references", async () => {
  const container = document.createElement("div");
  container.innerHTML =
    '<img src="https://images/initial"><div><img src="https://images/nested"></div>';
  document.body.append(container);
  const acquired: string[] = [];
  const released: string[] = [];
  const stop = cacheImagesInContainer(
    container,
    async (url) => {
      acquired.push(url);
      return `blob:${url}`;
    },
    (url) => {
      released.push(url);
    },
  );
  await mutations();
  expect(acquired).toEqual(["https://images/initial", "https://images/nested"]);
  const direct = document.createElement("img");
  direct.src = "https://images/direct";
  container.append(direct);
  await mutations();
  expect(direct.src).toBe("blob:https://images/direct");
  direct.remove();
  await mutations();
  expect(released).toEqual(["https://images/direct"]);
  stop();
  container.remove();
  expect(released.sort()).toEqual([
    "https://images/direct",
    "https://images/initial",
    "https://images/nested",
  ]);
});

test("removed and unmounted images release delayed acquisitions without changing detached nodes", async () => {
  const container = document.createElement("div");
  const image = document.createElement("img");
  image.src = "https://images/slow";
  container.append(image);
  document.body.append(container);
  let resolve!: (value: string) => void;
  const released: string[] = [];
  const stop = cacheImagesInContainer(
    container,
    () =>
      new Promise((yes) => {
        resolve = yes;
      }),
    (url) => {
      released.push(url);
    },
  );
  image.remove();
  await mutations();
  stop();
  resolve("blob:slow");
  await mutations();
  expect(image.src).toBe("https://images/slow");
  expect(released).toEqual(["https://images/slow"]);
  container.remove();
});

test("changing the source releases the prior image and acquires the new source", async () => {
  const container = document.createElement("div");
  const image = document.createElement("img");
  image.src = "https://images/first";
  container.append(image);
  document.body.append(container);
  const released: string[] = [];
  const stop = cacheImagesInContainer(
    container,
    async (url) => `blob:${url}`,
    (url) => {
      released.push(url);
    },
  );
  await mutations();
  image.src = "https://images/second";
  await mutations();
  expect(released).toEqual(["https://images/first"]);
  expect(image.src).toBe("blob:https://images/second");
  stop();
  container.remove();
});

test("a late acquisition cannot overwrite a new source before observer delivery", async () => {
  const container = document.createElement("div");
  const image = document.createElement("img");
  image.src = "https://images/old";
  container.append(image);
  document.body.append(container);
  let finish!: (value: string) => void;
  const released: string[] = [];
  const stop = cacheImagesInContainer(
    container,
    (url) =>
      url.endsWith("/old")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve("blob:new"),
    (url) => {
      released.push(url);
    },
  );
  image.src = "https://images/new";
  finish("blob:old");
  await Promise.resolve();
  expect(image.src).not.toBe("blob:old");
  await mutations();
  expect(image.src).toBe("blob:new");
  expect(released).toEqual(["https://images/old"]);
  stop();
  container.remove();
});
