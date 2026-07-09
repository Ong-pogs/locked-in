import { withSerwist } from '@serwist/turbopack';

export default withSerwist({
  turbopack: {
    root: process.cwd(),
  },
  // Keep the dev-tools badge out of screenshots (visual e2e determinism).
  devIndicators: false,
});
