import { afterEach, describe, expect, test } from "vitest";
import { localized, setActiveLocale, t } from "./t.js";

// The i18n layer is a process-global singleton; reset to the hu default so one
// test's locale switch never leaks into the next.
afterEach(() => setActiveLocale("hu"));

describe("t() locale switching (Phase 9, FR-9.1)", () => {
  test("under the hu default, the source literal is returned as-is", () => {
    expect(t("Bejelentkezés ChatGPT-fiókkal")).toBe("Bejelentkezés ChatGPT-fiókkal");
  });

  test("under en, the catalog translation is returned", () => {
    setActiveLocale("en");
    expect(t("Bejelentkezés ChatGPT-fiókkal")).toBe("Sign in with your ChatGPT account");
  });

  test("a missing en key falls back to the hu literal, never a blank or a marker", () => {
    setActiveLocale("en");
    expect(t("Nincs ilyen kulcs a katalógusban")).toBe("Nincs ilyen kulcs a katalógusban");
  });
});

describe("localized() manifest-string selection (Phase 9, FR-9.1)", () => {
  test("picks hu under the hu default", () => {
    expect(localized({ hu: "Üzenet", en: "Message" })).toBe("Üzenet");
  });

  test("picks en under en", () => {
    setActiveLocale("en");
    expect(localized({ hu: "Üzenet", en: "Message" })).toBe("Message");
  });

  test("falls back to hu under en when no en string is supplied", () => {
    setActiveLocale("en");
    expect(localized({ hu: "Üzenet" })).toBe("Üzenet");
  });
});
