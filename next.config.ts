import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev indicator is a fixed circular badge in the bottom-left corner, which
  // is exactly where the renderer status caption sits. Capture runs read the
  // frame as the deliverable, so the badge would be stamped onto every screenshot.
  devIndicators: false,
};

export default nextConfig;
