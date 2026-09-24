import DeckCard from "@/components/deck/deck-card";
import DeckCardSkeleton from "@/components/deck/deck-card-skeleton";
import { useCardsForDeck, useDeck } from "@/components/hooks/query";

type DeckCardContainerProps = {
  id: string;
};

/**
 * Container for a deck card
 */
export default function DeckCardContainer({ id }: DeckCardContainerProps) {
  const deck = useDeck(id);
  const cards = useCardsForDeck(id);

  if (!deck) {
    return <DeckCardSkeleton />;
  }

  return (
    <DeckCard
      id={id}
      name={deck.name}
      description={deck.description}
      lastModified={new Date(deck.lastModified)}
      cardCount={cards.length}
    />
  );
}

DeckCardContainer.displayName = "Deck";
