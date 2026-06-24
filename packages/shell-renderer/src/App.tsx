import { useEffect, useState } from "react";
import type { AuthState, BootState, ShellApi } from "@foreman/shell-main/ipc";
import { Home } from "./screens/Home.js";
import { Login } from "./screens/Login.js";
import { RestartBanner } from "./screens/RestartBanner.js";
import { StartupError } from "./screens/StartupError.js";
import { setActiveLocale, type Locale } from "./t.js";
import { themeTokens } from "./theme.js";

export function App({ api }: { api: ShellApi }) {
  const [boot, setBoot] = useState<BootState | undefined>();
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });
  const [locale, setLocale] = useState<Locale>("hu");

  // The active locale is a module singleton the whole tree reads through t();
  // mirror our state into it on every render so children always see the locale
  // this render is committing — before they themselves render (FR-9.1).
  setActiveLocale(locale);

  useEffect(() => {
    let cancelled = false;
    void api.getBootState().then((state) => {
      if (cancelled) return;
      setBoot(state);
      if (state.ok) document.title = state.manifest.branding.productName;
    });
    // Apply the persisted locale before the first real screen paints (FR-9.1).
    void api.getSettings().then((settings) => {
      if (!cancelled) setLocale(settings.locale);
    });
    const unsubscribe = api.onAuthState(setAuth);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [api]);

  const changeLocale = (next: Locale) => {
    setActiveLocale(next);
    setLocale(next);
    void api.setLocale(next);
  };

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
    <main className="app" style={themeTokens(boot.manifest.branding) as React.CSSProperties}>
      {auth.status === "agentError" ? (
        // The codex process died (FR-2.5) — a calm banner over everything.
        <RestartBanner message={auth.message} api={api} />
      ) : auth.status === "signedIn" ? (
        <Home
          manifest={boot.manifest}
          account={auth.account}
          shellVersion={boot.shellVersion}
          api={api}
          locale={locale}
          onLocaleChange={changeLocale}
        />
      ) : (
        <Login auth={auth} api={api} />
      )}
    </main>
  );
}
