import CardsTable from "@/components/cards-table";
import { useCardsForDeck, useDeck } from "@/components/hooks/query";
import ReturnToTop from "@/components/return-to-top";
import SearchBar from "@/components/search-bar";
import { Separator } from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { useParams } from "react-router";

export default function DeckRoute() {
  const params = useParams();
  const deckId = params.deckId as string;

  const deck = useDeck(deckId);
  const cards = useCardsForDeck(deckId);
  const [search, setSearch] = useState("");
  const filteredCards = cards.filter((card) =>
    (card.front.toLowerCase() + card.back.toLowerCase()).includes(
      search.toLowerCase(),
    ),
  );
  const reverseChronologySortedCards = filteredCards.sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  if (!deck) {
    return <div>Deck not found</div>;
  }

  return (
    <div className="md:px-24 xl:px-0 col-span-12 xl:col-start-3 xl:col-end-11">
      <ReturnToTop />
      <SearchBar
        search={search}
        setSearch={setSearch}
        placeholder="Search cards..."
      />
      <div className="mb-4 px-2">
        <h1 className="text-2xl md:text-4xl font-bold tracking-wide">
          {deck.name}
        </h1>
        <p className="text-sm text-muted-foreground">{deck.description}</p>
      </div>
      <Separator className="my-4" />
      <CardsTable cards={reverseChronologySortedCards} />
    </div>
  );
}
