import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Founding100Hero } from '@/components/Founding100Hero';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('Founding100Hero', () => {
  it('states the commitment clearly and routes the CTA to the catalog', () => {
    render(<Founding100Hero variant="mobile" />);

    expect(
      screen.getByRole('heading', { name: 'Stop collecting courses. Finish one.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Unaudited software/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Join the Founding 100/ })).toHaveAttribute(
      'href',
      '/courses',
    );
    const riskLink = screen.getByRole('link', { name: 'Read the risks' });
    expect(riskLink).toHaveAttribute('href', '/risk');
    expect(riskLink).toHaveClass('min-h-11');
    expect(screen.getByRole('link', { name: 'Get help' })).toHaveClass('min-h-11');
  });
});
