const nextConfig = {
  reactStrictMode: true,
  output: "standalone",

  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "https://kalusmart-trade-api.onrender.com/api/:path*",
      },
    ];
  },
};

export default nextConfig;