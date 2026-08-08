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
