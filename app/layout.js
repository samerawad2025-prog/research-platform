import "./globals.css";

export const metadata = {
  title: "Research Submission",
  description: "Submit your graduation research",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
