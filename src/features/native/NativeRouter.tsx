import { useMemo, useState, type ReactNode } from "react";
import {
  createPath,
  parsePath,
  Router,
  type Navigator,
  type To,
} from "react-router-dom";
import { postNative } from "./runtime";

/** Cross-screen navigation belongs to the native stack. Same-page replacements
 * still update React Router state (for example, consuming a highlight target).
 */
export function NativeRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<{
    pathname: string; search: string; hash: string; state: unknown; key: string;
  }>(() => ({
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    state: window.__readerInitialState ?? null,
    key: "native",
  }));
  const navigator = useMemo<Navigator>(() => {
    const navigate = (to: To, state: unknown) => {
      const path = typeof to === "string" ? parsePath(to) : to;
      if (path.pathname && path.pathname !== location.pathname) {
        postNative({ type: "navigate", path: createPath(path), state });
        return;
      }
      setLocation((current) => ({
        ...current,
        ...path,
        state,
        key: crypto.randomUUID(),
      }));
    };
    return {
      createHref: (to) => (typeof to === "string" ? to : createPath(to)),
      go: () => postNative({ type: "back" }),
      push: navigate,
      replace: navigate,
    };
  }, [location.pathname]);
  return (
    <Router location={location} navigator={navigator}>
      {children}
    </Router>
  );
}
