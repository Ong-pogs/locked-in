import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Founding100Hero } from '@/components/Founding100Hero';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('Founding100Hero', () => {
  it('states the commitment clearly and routes the CTA to the catalog', () => {
    render(<Founding100Hero variant="mobile" />);

    expect(
      screen.getByRole('heading', { level: 2, name: 'Stop collecting courses. Finish one.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unaudited software/)).toBeInTheDocument();
    expect(screen.getByText(/Joining does not reserve deposit capacity/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Join the Founding 100/ })).toHaveAttribute(
      'href',
      '/courses',
    );
    expect(screen.getByRole('link', { name: 'Read the risks' })).toHaveAttribute('href', '/risk');
  });
});
