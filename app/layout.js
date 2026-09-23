import Link from "next/link";
import "./globals.css";
import styles from "./layout.module.css";

export const metadata = {
  title: "Sudanese Academic Research Platform",
  description: "Submit Sudanese academic research for review and future publication.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <body className={styles.body}>
        <a href="#main-content" className={styles.skipLink}>
          Skip to main content
        </a>

        <header className={styles.header}>
          <div className={styles.headerInner}>
            <Link href="/" className={styles.wordmark}>
              Sudanese Academic Research Platform
            </Link>
            <nav>
              <Link href="/submit" className={styles.navLink}>
                Submit research
              </Link>
            </nav>
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className={styles.main}>
          {children}
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerInner}>
            <p className={styles.footerLead}>Questions about a submission? Contact the platform team.</p>
            <ul className={styles.contactList}>
              <li>
                <a href="mailto:sarpcontact2026@gmail.com" className={styles.contactLink}>
                  Email: sarpcontact2026@gmail.com
                </a>
              </li>
              <li>
                <a href="https://wa.me/249117754018" className={styles.contactLink}>
                  WhatsApp: +249117754018
                </a>
              </li>
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
