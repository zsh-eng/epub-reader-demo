import { useEffect, type ReactNode } from "react";
import { BrowserRouter, MemoryRouter, useLocation } from "react-router-dom";
import { getLabRuntime } from "./runtime";

const LOCATION_KEY = "sync-lab-location";
function RememberLabLocation() {
  const location = useLocation();
  useEffect(() => {
    getLabRuntime()!.storage.setItem(
      LOCATION_KEY,
      location.pathname + location.search,
    );
  }, [location.pathname, location.search]);
  return null;
}

/** Memory history keeps each iframe in its configured runtime through navigation and restart. */
export function AppRouter({ children }: { children: ReactNode }) {
  const lab = getLabRuntime();
  if (!lab) return <BrowserRouter>{children}</BrowserRouter>;
  const location = lab.storage.getItem(LOCATION_KEY) ?? "/";
  return (
    <MemoryRouter initialEntries={[location]}>
      <RememberLabLocation />
      {children}
    </MemoryRouter>
  );
}
