import { markdownToHtml } from "@/lib/utils";

const cache = new Map<string, { html: string; images: string[] }>();
export function prepareCardContent(content: string) {
  const cached = cache.get(content);
  if (cached) return cached;
  const template = document.createElement("template");
  template.innerHTML = markdownToHtml(content);
  const images = new Set<string>();
  for (const image of template.content.querySelectorAll("img[src]")) {
    const source = new URL(image.getAttribute("src")!, location.href).href;
    if (!/^https?:/.test(source)) continue;
    images.add(source);
    // Do not start a browser download before IndexedDB has been checked.
    image.setAttribute("data-cache-src", source);
    image.removeAttribute("src");
    image.removeAttribute("srcset");
  }
  const result = { html: template.innerHTML, images: [...images] };
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(content, result);
  return result;
}
