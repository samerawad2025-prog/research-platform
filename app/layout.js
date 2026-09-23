import { cookies } from "next/headers";
import "./globals.css";
import LocaleProvider from "../components/LocaleProvider";
import SiteShell from "../components/SiteShell";
import { LOCALE_COOKIE, dirFor, messagesFor, normalizeLocale } from "../lib/i18n";
import styles from "../components/SiteShell.module.css";

// The language is read from the cookie on the server so a returning
// Arabic reader gets lang="ar" dir="rtl" in the very first HTML — no
// English/LTR flash that a client-side correction would cause.
async function currentLocale() {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function generateMetadata() {
  const { meta } = messagesFor(await currentLocale());
  return { title: meta.title, description: meta.description };
}

export default async function RootLayout({ children }) {
  const locale = await currentLocale();

  return (
    <html lang={locale} dir={dirFor(locale)}>
      <body className={styles.body}>
        <LocaleProvider initialLocale={locale}>
          <SiteShell>{children}</SiteShell>
        </LocaleProvider>
      </body>
    </html>
  );
}
