import { prepareCardContent } from "@/lib/images/card-images";
import { cn } from "@/lib/utils";

// Note: code styling CSS is imported in main.tsx
export default function FlashcardContent({ content }: { content: string }) {
  // We can't use justify-center here because it prevents scrolling to the top of the container
  // when the container overflows.
  // See this https://stackoverflow.com/questions/33454533/cant-scroll-to-top-of-flex-item-that-is-overflowing-container

  // To solve this we add 2 pseudo elements that take up the remaining height
  // and only use `items-center` to center horizontally.

  return (
    <article
      className={cn(
        'prose min-h-96 h-[55dvh] overflow-y-auto flex flex-col flex-1 p-2 rounded-none w-full animate-in fade-in before:content-[""] after:content-[""] before:flex-1 after:flex-1 items-center prose-img:rounded-lg transition-all duration-300',
        "sm:h-[400px] sm:shadow-xs",
        "sm:dark:bg-muted/20 sm:border dark:border-none dark:prose-p:text-foreground dark:prose-strong:text-foreground dark:prose-li:text-foreground dark:prose-code:text-foreground dark:prose-pre:text-foreground dark:prose-ul:text-foreground dark:prose-ol:text-foreground",
        // Ensure that the <pre> elements don't have their own scrollbar.
        // If they do, the elements can end up really short when there are other elements in the container.
        // Instead, we want the <pre> to fill up the container as well
        "prose-code:whitespace-pre-wrap [&_pre]:p-0 sm:[&_pre]:rounded-none [&_pre]:!overflow-visible [&_pre_code]:!overflow-visible",
      )}
      dangerouslySetInnerHTML={{
        __html: prepareCardContent(content).html,
      }}
    ></article>
  );
}
