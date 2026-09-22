import "./globals.css";

export const metadata = {
  title: "Research Submission",
  description: "Submit your graduation research",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
