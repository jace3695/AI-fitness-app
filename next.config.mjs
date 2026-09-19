// E2E builds must never fall back to the hosted personal-data project.
if (process.env.YEONI_E2E === '1' && (
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321'
  || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.VERCEL
)) throw new Error('E2E requires the isolated loopback Supabase stack.');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel에서 자동 최적화
  reactStrictMode: true,
  // 이미지 최적화 (필요시 도메인 추가)
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: "/assistant/connect",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
