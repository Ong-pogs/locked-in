// Root page is never reached — middleware (proxy.ts) redirects / → /village
// at the edge before this renders. Kept as a placeholder so Next.js doesn't
// 404 on the root segment if middleware ever short-circuits.
export default function RootPage() {
  return null;
}
