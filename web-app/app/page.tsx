import { redirect } from 'next/navigation';

// Landing → village hub. Unauthenticated users can wander the village and
// every inner page; only action-y operations (Lock & Start, Brew, Buy, etc.)
// gate on a wallet connection.
export default function RootPage() {
  redirect('/village');
}
