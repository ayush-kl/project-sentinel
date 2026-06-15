/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    MONITOR_URL: process.env.MONITOR_URL ?? "http://localhost:4001",
    RECORDER_URL: process.env.RECORDER_URL ?? "http://localhost:4002",
  },
};

export default nextConfig;
