import { useState } from "react";
import { signInWithGoogle } from "@/lib/auth";
export function GoogleSignIn() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState<string>();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        className="rounded border px-4 py-2"
        onClick={async () => {
          setPending(true);
          setError(undefined);
          try {
            await signInWithGoogle();
          } catch (error) {
            setError(error instanceof Error ? error.message : "Sign-in failed");
            setPending(false);
          }
        }}
      >
        {pending ? "Connecting…" : "Continue with Google"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
