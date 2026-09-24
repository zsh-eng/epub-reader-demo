import { findVimMatches } from "./vim-navigation";
let text = "";
self.onmessage = (
  event: MessageEvent<{ text?: string; id: number; query: string; wholeWord: boolean }>,
) => {
  if (event.data.text !== undefined) text = event.data.text;
  const { id, query, wholeWord } = event.data;
  const matches = Uint32Array.from(findVimMatches(text, query, wholeWord));
  self.postMessage({ id, matches }, { transfer: [matches.buffer] });
};
