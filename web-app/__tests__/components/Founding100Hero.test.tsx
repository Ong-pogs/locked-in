import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Founding100Hero } from '@/components/Founding100Hero';

const track = vi.hoisted(() => vi.fn());

vi.mock('@vercel/analytics', () => ({ track }));

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

  it('records only the fixed CTA placement when a visitor joins', () => {
    render(<Founding100Hero variant="desktop" />);

    const cta = screen.getByRole('link', { name: /Join the Founding 100/ });
    cta.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(cta);

    expect(track).toHaveBeenCalledWith('founding_100_cta', { placement: 'desktop' });
  });
});
