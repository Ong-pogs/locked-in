import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DepositFormV2,
  CONSENT_STORAGE_KEY,
  TERMS_VERSION,
} from '@/components/v2/DepositFormV2';

const recordConsent = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', () => ({
  fetchWithAuth: (fn: (token: string) => Promise<unknown>) => fn('test-token'),
}));

vi.mock('@/services/api/httpClient', () => ({
  httpRequest: (path: string, options: Record<string, unknown>) => {
    recordConsent(path, options);
    return Promise.resolve({});
  },
}));

function renderForm(overrides: Partial<React.ComponentProps<typeof DepositFormV2>> = {}) {
  const onSubmit = vi.fn();
  render(
    <DepositFormV2
      courseTitle="Blockchain & Wallets"
      currentTvlUi={120}
      walletBalanceUi="500"
      phase="idle"
      statusMessage={null}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('DepositFormV2 consent gate', () => {
  beforeEach(() => {
    localStorage.clear();
    recordConsent.mockClear();
  });

  it('does not promise that principal is always returned', () => {
    renderForm();

    expect(screen.queryByText(/principal is always returned/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('v2-deposit-risk')).toHaveTextContent(/never taken as a penalty/i);
    expect(screen.getByTestId('v2-deposit-risk')).toHaveTextContent(/Kamino/);
  });

  it('blocks the lock button until the acknowledgement is checked', () => {
    const { onSubmit } = renderForm();

    const submit = screen.getByTestId('v2-deposit-submit');
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId('v2-consent-checkbox'));

    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith('25');
  });

  it('persists acceptance and reports it to the backend once', () => {
    renderForm();

    fireEvent.click(screen.getByTestId('v2-consent-checkbox'));

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBe(TERMS_VERSION);
    expect(recordConsent).toHaveBeenCalledTimes(1);
    const [path, options] = recordConsent.mock.calls[0];
    expect(path).toBe('/v1/locks/consent');
    expect(options.method).toBe('POST');
    expect(options.body.termsVersion).toBe(TERMS_VERSION);
    expect(typeof options.body.acceptedAt).toBe('string');
  });

  it('starts accepted when this terms version was already accepted', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, TERMS_VERSION);

    renderForm();

    expect(screen.getByTestId('v2-consent-checkbox')).toBeChecked();
    expect(screen.getByTestId('v2-deposit-submit')).toBeEnabled();
    expect(recordConsent).not.toHaveBeenCalled();
  });

  it('re-asks when the stored acceptance is for an older terms version', () => {
    localStorage.setItem(CONSENT_STORAGE_KEY, '1900-01-01');

    renderForm();

    expect(screen.getByTestId('v2-consent-checkbox')).not.toBeChecked();
    expect(screen.getByTestId('v2-deposit-submit')).toBeDisabled();
  });

  it('does not block the deposit when the consent report fails', () => {
    recordConsent.mockImplementationOnce(() => {
      throw new Error('network down');
    });

    const { onSubmit } = renderForm();

    fireEvent.click(screen.getByTestId('v2-consent-checkbox'));

    const submit = screen.getByTestId('v2-deposit-submit');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalled();
  });
});
