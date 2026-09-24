import MemoryDB from "@/lib/db/memory";

export function searchForLinks(): Map<string, string> {
  const cards = MemoryDB.getCards();
  const imageLinkRegex = /!\[(?<alt>.*?)\]\((?<url>.*?)\)/g;

  const links = new Map<string, string>();
  for (const card of cards) {
    const text = card.front + card.back;
    const matches = text.matchAll(imageLinkRegex);
    for (const match of matches) {
      if (!match.groups) continue;
      links.set(match.groups.url, match.groups.alt);
    }
  }

  return links;
}
