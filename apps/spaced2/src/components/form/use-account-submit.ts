import { useCallback, useRef, useState } from "react";

/** Keep account fields available after a failed request and block duplicate submissions. */
export function useAccountSubmit<T>(onSubmit: (values: T) => Promise<void>) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submit = useCallback(
    async (values: T) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);
      setError(undefined);
      try {
        await onSubmit(values);
      } catch {
        setError(
          "Could not complete the request. Check your connection and try again.",
        );
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [onSubmit],
  );
  return { submit, pending, error };
}
