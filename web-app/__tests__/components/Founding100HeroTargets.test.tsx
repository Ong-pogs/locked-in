import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Founding100Hero } from '@/components/Founding100Hero';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('Founding100Hero mobile targets', () => {
  it('keeps both secondary acquisition links at mobile target height', () => {
    render(<Founding100Hero variant="mobile" />);

    expect(screen.getByRole('link', { name: 'Read the risks' })).toHaveClass('min-h-11');
    expect(screen.getByRole('link', { name: 'Get help' })).toHaveClass('min-h-11');
  });
});
