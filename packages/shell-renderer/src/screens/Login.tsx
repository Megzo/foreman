import type { AuthState, ShellApi } from "@foreman/shell-main/ipc";
import { t } from "../t.js";

export function Login({ auth, api }: { auth: AuthState; api: ShellApi }) {
  if (auth.status === "loginPending") {
    if (auth.flow.type === "chatgptDeviceCode") {
      return (
        <section className="login" data-testid="login-pending">
          <p>{t("Nyisd meg ezt a címet, és írd be a kódot:")}</p>
          <p className="device-url">{auth.flow.verificationUrl}</p>
          <p className="device-code">{auth.flow.userCode}</p>
        </section>
      );
    }
    return (
      <section className="login" data-testid="login-pending">
        <p>{t("Bejelentkezés folyamatban a böngészőben…")}</p>
      </section>
    );
  }

  if (auth.status === "loginFailed") {
    // Friendly text only; the raw cause stays behind a details expander (UX requirement).
    return (
      <section className="login" data-testid="login-failed">
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
