import { useEffect, useState } from "react";
import type { AuthState, BootState, ShellApi } from "@foreman/shell-main/ipc";
import { Home } from "./screens/Home.js";
import { Login } from "./screens/Login.js";
import { StartupError } from "./screens/StartupError.js";

/** Branding-driven theme tokens; the shell must look like the client's app. */
function themeStyle(boot: BootState): React.CSSProperties {
  if (!boot.ok) return {};
  const { colors } = boot.manifest.branding;
  return {
    "--color-primary": colors.primary,
    "--color-background": colors.background ?? "#ffffff",
    "--color-accent": colors.accent ?? colors.primary,
  } as React.CSSProperties;
}

export function App({ api }: { api: ShellApi }) {
  const [boot, setBoot] = useState<BootState | undefined>();
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;
    void api.getBootState().then((state) => {
      if (cancelled) return;
      setBoot(state);
      if (state.ok) document.title = state.manifest.branding.productName;
    });
    const unsubscribe = api.onAuthState(setAuth);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  if (boot && !boot.ok) {
    // A broken manifest blocks startup (FR-1.2) — auth state is irrelevant.
    return (
      <main className="app">
        <StartupError error={boot.error} />
      </main>
    );
  }

  if (!boot || auth.status === "checking") {
    return <main className="app" data-testid="screen-loading" />;
  }

  return (
    <main className="app" style={themeStyle(boot)}>
      {auth.status === "signedIn" ? (
        <Home
          manifest={boot.manifest}
          account={auth.account}
          shellVersion={boot.shellVersion}
          api={api}
        />
      ) : (
        <Login auth={auth} api={api} />
      )}
    </main>
  );
}
