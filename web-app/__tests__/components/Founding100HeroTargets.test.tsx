import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Founding100Hero } from '@/components/Founding100Hero';

vi.mock('@vercel/analytics', () => ({ track: vi.fn() }));

describe('Founding100Hero secondary targets', () => {
  it.each(['mobile', 'desktop'] as const)(
    'keeps both %s acquisition links at accessible target height',
    (variant) => {
      render(<Founding100Hero variant={variant} />);

      expect(screen.getByRole('link', { name: 'Read the risks' })).toHaveClass('min-h-11');
      expect(screen.getByRole('link', { name: 'Get help' })).toHaveClass('min-h-11');
    },
  );
});
