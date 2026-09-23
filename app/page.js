import Link from "next/link";
import styles from "./page.module.css";

export default function HomePage() {
  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Sudanese Academic Research Platform</h1>
        <p className={styles.lead}>
          A straightforward way to submit Sudanese academic research for review and future
          publication. The platform reads key details from your document, so you don&rsquo;t have
          to retype them.
        </p>
        <Link href="/submit" className={styles.cta}>
          Submit your research
        </Link>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>How it works</h2>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <h3 className={styles.stepHeading}>Upload</h3>
            <p className={styles.stepText}>Upload your research as a PDF or DOCX document.</p>
          </li>
          <li className={styles.step}>
            <h3 className={styles.stepHeading}>Review</h3>
            <p className={styles.stepText}>
              The platform reads details such as the title, abstract and research team from your
              document.
            </p>
          </li>
          <li className={styles.step}>
            <h3 className={styles.stepHeading}>Confirm</h3>
            <p className={styles.stepText}>
              Check the extracted details and correct anything that needs changing before you
              confirm.
            </p>
          </li>
        </ol>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionHeading}>What you can submit</h2>
        <p className={styles.sectionText}>
          Academic work such as theses, dissertations, journal articles, conference papers and
          other academic papers.
        </p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Accepted formats</dt>
            <dd>PDF or DOCX</dd>
          </div>
          <div className={styles.fact}>
            <dt>Maximum file size</dt>
            <dd>20 MB</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
