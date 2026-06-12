import { useState } from "react";
import type { AccountInfo, AppManifest, ShellApi } from "@foreman/shell-main/ipc";
import { localized, t } from "../t.js";

export function Home({
  manifest,
  account,
  shellVersion,
  api,
}: {
  manifest: AppManifest;
  account: AccountInfo;
  shellVersion: string;
  api: ShellApi;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <section className="home">
      <header className="home-header">
        <h1>{manifest.branding.productName}</h1>
        <button
          type="button"
          className="link"
          aria-label={t("Beállítások")}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {t("Beállítások")}
        </button>
      </header>
      {settingsOpen ? (
        <aside className="settings-menu">
          <p>{account.email ?? account.type}</p>
          <p>
            {t("Verzió")}: {shellVersion} · {manifest.name} {manifest.version}
          </p>
          <button type="button" onClick={() => void api.logout()}>
            {t("Kijelentkezés")}
          </button>
        </aside>
      ) : null}
      <div className="launchers">
        {manifest.tasks.map((task) => (
          <button type="button" key={task.id} className="launcher-card" disabled>
            <strong>{localized(task.label)}</strong>
            {task.description ? <span>{localized(task.description)}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
