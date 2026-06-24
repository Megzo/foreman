import type { AuthState, ManifestBranding, ShellApi } from "@foreman/shell-main/ipc";
import { t } from "../t.js";

/** App identity at the top of every login state — the screen is branded, not generic. */
function Brand({ branding }: { branding?: ManifestBranding }) {
  if (!branding) return null;
  return (
    <div className="login-brand">
      {branding.icon ? (
        <img className="login-icon" src={branding.icon} alt="" />
      ) : (
        // No manifest icon: a brand-tinted monogram of the product name.
        <div className="login-monogram" aria-hidden="true">
          {branding.productName.trim().charAt(0).toUpperCase()}
        </div>
      )}
      <h1>{branding.productName}</h1>
    </div>
  );
}

export function Login({
  auth,
  api,
  branding,
}: {
  auth: AuthState;
  api: ShellApi;
  branding?: ManifestBranding;
}) {
  if (auth.status === "loginPending") {
    if (auth.flow.type === "chatgptDeviceCode") {
      return (
        <section className="login" data-testid="login-pending">
          <Brand branding={branding} />
          <p>{t("Nyisd meg ezt a címet, és írd be a kódot:")}</p>
          <p className="device-url">{auth.flow.verificationUrl}</p>
          <p className="device-code">{auth.flow.userCode}</p>
        </section>
      );
    }
    // chatgpt flow: the browser may not have opened (WSL/headless), so always
    // show the auth URL as a manual fallback the user can open or copy.
    const { authUrl, browserOpened } = auth.flow;
    return (
      <section className="login" data-testid="login-pending">
        <Brand branding={branding} />
        <p>
          {browserOpened === false
            ? t("Nem sikerült megnyitni a böngészőt. Nyisd meg ezt a címet a bejelentkezéshez:")
            : t("Bejelentkezés folyamatban a böngészőben. Ha nem nyílt meg, nyisd meg ezt a címet:")}
        </p>
        <p className="auth-url">
          <a href={authUrl} target="_blank" rel="noreferrer">
            {authUrl}
          </a>
        </p>
        <button
          type="button"
          className="link"
          onClick={() => void navigator.clipboard?.writeText(authUrl)}
        >
          {t("Link másolása")}
        </button>
        <button type="button" className="link" onClick={() => void api.cancelLogin()}>
          {t("Mégse")}
        </button>
      </section>
    );
  }

  if (auth.status === "loginFailed") {
    // Friendly text only; the raw cause stays behind a details expander (UX requirement).
    return (
      <section className="login" data-testid="login-failed">
        <Brand branding={branding} />
        <p>{t("A bejelentkezés nem sikerült.")}</p>
        <button type="button" className="primary" onClick={() => void api.cancelLogin()}>
          {t("Újrapróbálás")}
        </button>
        <details>
          <summary>{t("Részletek")}</summary>
          <pre>{auth.message}</pre>
        </details>
      </section>
    );
  }

  return (
    <section className="login">
      <Brand branding={branding} />
      <p>{t("Jelentkezz be a ChatGPT-fiókoddal, és kezdődhet a munka.")}</p>
      <button type="button" className="primary" onClick={() => void api.startLogin("chatgpt")}>
        {t("Bejelentkezés ChatGPT-fiókkal")}
      </button>
      <button
        type="button"
        className="link"
        onClick={() => void api.startLogin("chatgptDeviceCode")}
      >
        {t("Bejelentkezés kóddal")}
      </button>
    </section>
  );
}
