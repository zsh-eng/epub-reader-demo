---
name: flashcard-creator
description: >
  Create high-quality flashcards from technical content, especially computer science topics.
  Use this skill whenever the user asks to create flashcards, study cards, review cards, spaced
  repetition cards, or wants to turn notes/content/code into something memorizable. Also trigger
  when the user says things like "help me remember this", "make cards for this", "I want to study
  this", "create anki-style cards", or "turn this into Q&A". This skill focuses on CS concepts
  (algorithms, data structures, correctness proofs, code patterns, bug identification) but works
  for any domain. Always use this skill even if the user just pastes code or concepts and says
  "flashcards" — don't wait for a more explicit request.
---

# Flashcard Creator

Create flashcards that follow evidence-based principles for long-term retention. Cards are
output in the **spaced-bundle-v1 authoring syntax** — a markdown format designed for
deterministic parsing and easy import.

## Output Format

All cards are written to a single `.md` file using the authoring syntax defined below.

### Card block structure

Every card follows this pattern:

```md
Q: First line of question
More question lines...
A: First line of answer
More answer lines...

===
```

Rules:
- `Q:` starts the question block.
- First top-level `A:` after `Q:` starts the answer block.
- `===` ends the card block.
- Put a blank line before `===` to avoid Setext heading rendering.
- Everything between markers is preserved verbatim (including newlines).
- Markers must start at column 1 (no leading spaces).
- Escape literal markers with a backslash if they appear in content: `\Q:`, `\A:`, `\===`.

### Basic card (question → answer)

```md
Q: What is the time complexity of binary search on a sorted array of n elements?
A: O(log n)

===
```

### Cloze card (fill-in-the-blank)

Use Anki-style cloze tokens in the `Q:` block: `{{c1::text}}` or `{{c1::text::hint}}`.

Each unique cloze index (`c1`, `c2`, ...) produces one card during import. Multiple
deletions sharing the same index appear together on one card. The `front` and `back` in
the generated manifest are left unchanged — the importer handles masking.

```md
Q: {{c1::O(log n)}} is the time complexity of binary search on a sorted array
A: Binary search halves the search space on each step.

===
```

Multiple cloze indices in one card (generates 2 cards on import):

```md
Q: The time complexity of binary search is {{c1::O(log n)}} and it requires the input to be {{c2::sorted}}.
A: Binary search halves the search space each step, but only works on sorted data.

===
```

### Reverse card

Place `@reverse` on its own line before `Q:` to generate both a forward and a reverse card:

```md
@reverse
Q: Capital of France
A: Paris

===
```

### Image links

When the source material includes diagrams or images, reference them inside `Q:` or `A:` blocks:

- `![[name.png]]` — Obsidian wiki-link
- `![[assets/name.png]]` — Obsidian wiki-link with path
- `![](relative/path.png)` — Standard markdown image

The compiler rewrites these to `asset://` placeholders during bundle creation.

### Multiple cards in one file

Cards are separated by the `===` terminator. Just write them consecutively:

```md
Q: What does a hash table use to map keys to indices?
A: A hash function

===

Q: {{c1::O(1)}} is the average-case time complexity of hash table lookup
A: Hash tables provide constant-time average lookup via direct index computation.

===

Q: Why can hash table worst-case lookup degrade to O(n)?
A: When many keys hash to the same bucket (hash collisions), lookup must traverse the entire chain/bucket.

===
```

## Card Writing Principles

These principles are drawn from the "20 Rules of Formulating Knowledge" and years of spaced
repetition research. They are not optional — every card must follow them.

### 1. One atomic fact per card

Each card tests exactly one thing. If you find yourself writing "and" in the answer, split it.

Bad:
```md
Q: What are the properties of a BST?
A: Left children are smaller, right children are larger, and both subtrees are BSTs

===
```

Good (three separate cards):
```md
Q: In a BST, all keys in the left subtree of a node are {{c1::smaller (less)}} than the node's key
A: The BST left-subtree property.

===

Q: In a BST, all keys in the right subtree of a node are {{c1::greater}} than the node's key
A: The BST right-subtree property.

===

Q: The BST property must hold not just for immediate children, but for {{c1::the entire subtree}}
A: The ordering constraint is recursive — it applies to every descendant, not just direct children.

===
```

### 2. Understand first, then card

Never create a card for something the source material doesn't clearly explain. If the user
provides content that's unclear, ask for clarification rather than generating shallow cards.

### 3. Prefer cloze deletion for definitions and facts

Cloze cards are faster to write and often more effective. Use them heavily, especially for:
- Definitions
- Complexity bounds
- Property statements
- Code patterns

### 4. Build from basics to complex

When generating cards from a topic, start with foundational concepts before creating cards
about edge cases or advanced properties. Order the output cards from basic → advanced.

### 5. Fight interference with context

When two concepts are easily confused (e.g., BFS vs DFS, stack vs queue), create cards that
explicitly contrast them:

```md
Q: BFS uses a {{c1::queue}} while DFS uses a {{c2::stack}}
A: BFS explores level-by-level (queue/FIFO); DFS explores depth-first (stack/LIFO).

===
```

### 6. Optimize wording — be concise

Strip unnecessary words. Make the question unambiguous in as few words as possible.

Bad:
```md
Q: Can you tell me what the worst-case time complexity of the quicksort algorithm is when the pivot selection is poor?
A: O(n²)

===
```

Good:
```md
Q: Quicksort worst-case time complexity (bad pivot)?
A: O(n²)

===
```

### 7. Use code snippets when they clarify

For CS flashcards, short code snippets are often better than prose descriptions.

```md
Q: What's wrong with this binary search?

def search(arr, target):
    lo, hi = 0, len(arr)
    while lo < hi:
        mid = (lo + hi) // 2
        if arr[mid] == target: return mid
        elif arr[mid] < target: lo = mid
        else: hi = mid
    return -1
A: `lo = mid` should be `lo = mid + 1` — without it, when arr[mid] < target and mid == lo, the loop never progresses (infinite loop).

===
```

### 8. "Why" cards for deep understanding

Don't just test facts — test reasoning. "Why" cards are especially valuable for algorithms:

```md
Q: Why does merge sort guarantee O(n log n) worst case while quicksort doesn't?
A: Merge sort always splits in half (balanced division). Quicksort's split depends on pivot choice — a bad pivot creates unbalanced partitions (e.g., 1 vs n-1), leading to O(n²).

===
```

### 9. Bug/error identification cards

For CS, cards that present buggy code and ask "what's wrong?" build debugging intuition:

```md
Q: What's the off-by-one error?

for (int i = 0; i <= arr.length; i++)
A: Should be `i < arr.length` — using `<=` causes ArrayIndexOutOfBoundsException on the last iteration.

===
```

### 10. Avoid sets and enumerations

Don't ask "list all X." If you must cover a set, break it into individual cards or use
overlapping clozes that test different elements.

### 11. Add redundancy through different angles

It's fine — even encouraged — to test the same fact from multiple angles:

```md
Q: The amortized time complexity of appending to a dynamic array is {{c1::O(1)}}
A: Resizes are rare enough that their cost is spread across many appends.

===

Q: Why is dynamic array append O(1) amortized despite occasional O(n) resizes?
A: Resizes double the capacity, so the cost of copying n elements is spread across the n insertions that triggered the resize — each insertion "pays" O(1) on average.

===
```

## CS-Specific Card Types

When working with CS content, prioritize these card types:

1. **Complexity cards** — time/space complexity of operations and algorithms
2. **Correctness cards** — why an algorithm works, loop invariants, inductive arguments
3. **Comparison cards** — when to use X vs Y, tradeoffs
4. **Bug identification** — spot the error in code
5. **Code pattern cards** — idiomatic patterns and why they're written that way
6. **Edge case cards** — what happens with empty input, single element, duplicates, etc.

## Workflow

1. Read the user's input (notes, code, textbook excerpt, topic name, etc.)
2. Identify the core concepts that are worth remembering long-term
3. Order concepts from foundational → advanced
4. Generate cards following the principles above using the spaced-bundle-v1 authoring syntax
5. Output all cards in a single markdown file (`.md`)
6. Save to a `flashcards.md` file in the current workspace, or another path requested by the user

If the user provides a large amount of content, aim for 30-50 cards. For a single concept or
short snippet, 5-10 cards is appropriate. Always prefer fewer, higher-quality cards over many
shallow ones.

If the user asks for cards on a broad topic (e.g., "make flashcards on graph algorithms") without
providing source material, generate cards from your own knowledge, still following all principles.
