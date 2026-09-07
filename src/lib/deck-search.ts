export function deckMatchesSearch(
  deck: { name: string; description: string },
  search: string,
) {
  return (deck.name + deck.description)
    .toLowerCase()
    .includes(search.trim().toLowerCase());
}
