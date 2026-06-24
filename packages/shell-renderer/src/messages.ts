/**
 * English message catalog (Phase 9, FR-9.1). hu is both the source language and
 * the lookup key — every `t("…")` call site passes the Hungarian literal, which
 * is the default-locale value *and* the key into this table for the en locale.
 * A missing key degrades to the hu literal (see `t`), so adding a string without
 * a translation never blanks the UI.
 *
 * App-author-facing text (manifest validation, the StartupError screen) stays
 * English-only (FR-9.2) and deliberately does not pass through here.
 */
export const en: Record<string, string> = {
  // Login screen (FR-3.2/3.3)
  "Bejelentkezés ChatGPT-fiókkal": "Sign in with your ChatGPT account",
  "Bejelentkezés kóddal": "Sign in with a code",
  "Nyisd meg ezt a címet, és írd be a kódot:": "Open this address and enter the code:",
  "Nem sikerült megnyitni a böngészőt. Nyisd meg ezt a címet a bejelentkezéshez:":
    "Could not open the browser. Open this address to sign in:",
  "Bejelentkezés folyamatban a böngészőben. Ha nem nyílt meg, nyisd meg ezt a címet:":
    "Signing in via the browser. If it didn't open, open this address:",
  "Link másolása": "Copy link",
  "A bejelentkezés nem sikerült.": "Sign-in failed.",
  "Újrapróbálás": "Try again",

  // Home screen (FR-3.4, FR-7.3)
  "Beállítások": "Settings",
  "Nyelv": "Language",
  "Verzió": "Version",
  "Kijelentkezés": "Sign out",
  "Korábbi futások": "Recent tasks",
  "Itt jelennek meg a korábbi feladataid, amint elindítasz egyet.":
    "Your past tasks will appear here once you start one.",
  "Egy korábbi feladat félbeszakadt:": "A previous task was interrupted:",
  "Folytatás": "Resume",
  "Új indítása": "Start new",

  // Run status labels (shared by history and the run view)
  "Folyamatban": "In progress",
  "Folyamatban…": "In progress…",
  "Kész": "Done",
  "Sikertelen": "Failed",
  "Megszakítva": "Cancelled",

  // Param form (FR-1.3)
  "Kötelező mező": "Required field",
  "Indítás": "Start",

  // Task screen + chat + cancel (FR-4.3/4.5)
  "Mégse": "Cancel",
  "Megszakítás": "Cancel",
  "Vissza": "Back",
  "Biztosan megszakítod a feladatot?": "Are you sure you want to cancel the task?",
  "Igen, megszakítom": "Yes, cancel it",
  "Nem": "No",
  "Üzenet a feladatnak": "Message to the task",
  "Üzenet küldése": "Send message",
  "Küldés": "Send",

  // Run view activity feed + terminal states (FR-4.6, FR-5.3, FR-6.3)
  "Lépés végrehajtása": "Running a step",
  "Fájlok írása": "Writing files",
  "Keresés": "Searching",
  "Eszköz használata": "Using a tool",
  "Gondolkodik…": "Thinking…",
  "Ezt a műveletet az alkalmazás nem engedélyezi.": "The app does not permit this action.",
  "A feladat sikeresen befejeződött.": "The task finished successfully.",
  "Mappa megnyitása": "Open folder",
  "A feladat nem sikerült.": "The task failed.",
  "A feladat megszakítva.": "The task was cancelled.",

  // Restart banner (FR-2.5)
  "A háttérszolgáltatás újraindult": "The background service restarted",
  "Folytathatod ott, ahol abbamaradt.": "You can continue where you left off.",
  "Részletek": "Details",
};
