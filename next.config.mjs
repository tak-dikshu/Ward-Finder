/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    agentUpgrade: 'security',
  },
  images: {
    unoptimized: true,
  },
  // OCR and PDF rendering run server-side only; keep them out of the bundle and
  // make sure their WASM and the Hindi/English models ship with the function.
  serverExternalPackages: ['mupdf', 'tesseract.js', 'tesseract.js-core'],
  outputFileTracingIncludes: {
    // tesseract.js loads its worker script (and that script's own dependencies) dynamically,
    // so the file tracer cannot see them. With pnpm they live next to the package inside
    // node_modules/.pnpm/<pkg>@<version>/node_modules, so include those folders explicitly.
    '/api/admin/import': [
      './assets/ocr/**/*',
      './node_modules/mupdf/**/*',
      './node_modules/tesseract.js-core/**/*',
      './node_modules/.pnpm/{tesseract.js,tesseract.js-core,node-fetch,whatwg-url}@*/node_modules/**/*',
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
