/** @type {import('next').NextConfig} */
const nextConfig = {
  // The agreement texts are read at request time by the terms route and
  // served only if their hash matches lib/submission/agreements.js.
  outputFileTracingIncludes: {
    '/api/submissions/terms': ['./docs/legal/*.md'],
    // The volunteer confidentiality texts (hash-checked before they are served).
    '/api/admin/[...path]': ['./docs/legal/*.md'],
  },
};

export default nextConfig;
