import { httpRequest } from '@/services/api/httpClient';

// One-time onboarding SOL stipend (onramp spec 2026-07-29). The backend drips
// to the authenticated session wallet only — there is nothing to send but the
// token. Pair with fetchWithAuth for refresh handling:
//   await fetchWithAuth(requestGasStipend)

export type GasStipendStatus = 'dripped' | 'already_dripped' | 'cap_reached';

export function requestGasStipend(token: string): Promise<{ status: GasStipendStatus }> {
  return httpRequest('/v1/wallet/gas-stipend', { method: 'POST', token });
}
