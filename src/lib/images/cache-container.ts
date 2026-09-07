import { getCachedImage, revokeImage } from "./db";

export function cacheImagesInContainer(
  container: HTMLElement,
  acquire = getCachedImage,
  release = revokeImage,
) {
  type Reference = { source: string; objectURL?: string; active: boolean };
  const references = new Map<HTMLImageElement, Reference>();
  let disposed = false;
  const imagesIn = (node: Node): HTMLImageElement[] =>
    node instanceof HTMLElement
      ? [
          ...(node.tagName === "IMG" ? [node as HTMLImageElement] : []),
          ...node.querySelectorAll<HTMLImageElement>("img"),
        ]
      : [];

  function remove(image: HTMLImageElement) {
    const reference = references.get(image);
    if (!reference) return;
    reference.active = false;
    references.delete(image);
    image.removeAttribute("data-is-cached-src");
    if (reference.objectURL) {
      release(reference.source);
      if (image.src === reference.objectURL) image.src = reference.source;
    }
  }

  function add(image: HTMLImageElement) {
    if (disposed || !container.contains(image)) return;
    const previous = references.get(image);
    if (
      previous &&
      (image.src === previous.source || image.src === previous.objectURL)
    )
      return;
    if (previous) remove(image);
    if (!/^https?:/.test(image.src)) return;
    const reference: Reference = { source: image.src, active: true };
    references.set(image, reference);
    image.setAttribute("data-is-cached-src", reference.source);
    void acquire(reference.source, image.alt).then(
      (objectURL) => {
        if (
          disposed ||
          !reference.active ||
          !container.contains(image) ||
          image.src !== reference.source
        ) {
          if (references.get(image) === reference) remove(image);
          release(reference.source);
          return;
        }
        reference.objectURL = objectURL;
        image.src = objectURL;
      },
      (error) => {
        if (references.get(image) === reference) {
          references.delete(image);
          image.removeAttribute("data-is-cached-src");
        }
        console.error("Could not cache image", error);
      },
    );
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        add(mutation.target as HTMLImageElement);
      } else {
        for (const node of mutation.removedNodes)
          imagesIn(node).forEach(remove);
        for (const node of mutation.addedNodes) imagesIn(node).forEach(add);
      }
    }
  });
  observer.observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  imagesIn(container).forEach(add);
  return () => {
    disposed = true;
    observer.disconnect();
    [...references.keys()].forEach(remove);
  };
}
