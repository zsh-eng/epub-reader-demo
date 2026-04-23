import { useCallback, useMemo, useState } from "react";

export type SheetStackRouterDirection = 1 | -1;

interface SheetStackSnapshot<Route extends string> {
  stack: Route[];
  direction: SheetStackRouterDirection;
}

export interface SheetStackRouterState<Route extends string> {
  stack: Route[];
  currentRoute: Route;
  direction: SheetStackRouterDirection;
  canGoBack: boolean;
}

export interface SheetStackRouterActions<Route extends string> {
  push: (route: Route) => void;
  pop: () => void;
  reset: (
    route?: Route,
    options?: { direction?: SheetStackRouterDirection },
  ) => void;
}

export interface UseSheetStackRouterResult<Route extends string> {
  state: SheetStackRouterState<Route>;
  actions: SheetStackRouterActions<Route>;
}

/**
 * Manages local stack navigation inside a persistent sheet or drawer.
 *
 * The sheet shell stays mounted while nested views push and pop on this stack,
 * which lets feature code model "forward" and "back" without involving the
 * app-level URL router.
 */
export function useSheetStackRouter<Route extends string>(
  initialRoute: Route,
): UseSheetStackRouterResult<Route> {
  const [snapshot, setSnapshot] = useState<SheetStackSnapshot<Route>>({
    stack: [initialRoute],
    direction: 1,
  });

  const push = useCallback((route: Route) => {
    setSnapshot((current) => {
      const currentRoute = current.stack[current.stack.length - 1];

      if (currentRoute === route) {
        return current;
      }

      return {
        stack: [...current.stack, route],
        direction: 1,
      };
    });
  }, []);

  const pop = useCallback(() => {
    setSnapshot((current) => {
      if (current.stack.length === 1) {
        return current;
      }

      return {
        stack: current.stack.slice(0, -1),
        direction: -1,
      };
    });
  }, []);

  const reset = useCallback(
    (
      route: Route = initialRoute,
      options?: { direction?: SheetStackRouterDirection },
    ) => {
      setSnapshot((current) => {
        if (current.stack.length === 1 && current.stack[0] === route) {
          return current;
        }

        return {
          stack: [route],
          direction: options?.direction ?? 1,
        };
      });
    },
    [initialRoute],
  );

  const state = useMemo<SheetStackRouterState<Route>>(() => {
    const currentRoute = snapshot.stack[snapshot.stack.length - 1] ?? initialRoute;

    return {
      stack: snapshot.stack,
      currentRoute,
      direction: snapshot.direction,
      canGoBack: snapshot.stack.length > 1,
    };
  }, [initialRoute, snapshot.direction, snapshot.stack]);

  const actions = useMemo<SheetStackRouterActions<Route>>(
    () => ({
      push,
      pop,
      reset,
    }),
    [pop, push, reset],
  );

  return {
    state,
    actions,
  };
}
