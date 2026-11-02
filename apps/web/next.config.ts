import type { NextConfig } from 'next';
import path from 'node:path';
const config: NextConfig = {
  transpilePackages:['@vodown/ui','@vodown/auth'],
  output:'standalone',
  outputFileTracingRoot:path.resolve(import.meta.dirname,'../..'),
};
export default config;
