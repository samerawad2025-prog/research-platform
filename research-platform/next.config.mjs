/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf-parse pulls in an optional canvas-rendering dependency it
  // doesn't need for plain text extraction. Next.js's build-time
  // bundler trips over that dependency's browser-only APIs even
  // though it's never actually called at runtime here. Marking the
  // package external tells Next.js to load it as a normal Node
  // require instead of trying to statically bundle it - confirmed
  // working directly under Node before this config existed.
  serverExternalPackages: ['pdf-parse'],
};

export default nextConfig;
