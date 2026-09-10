import { useEffect, useState } from "react";

/** Native UISearchController owns the search field; web pages own filtering. */
export function useNativeSearch() {
  const [query, setQuery] = useState("");
  useEffect(() => {
    const update = (event: Event) =>
      setQuery((event as CustomEvent<string>).detail);
    window.addEventListener("reader-native-search", update);
    return () => window.removeEventListener("reader-native-search", update);
  }, []);
  return [query, setQuery] as const;
}
