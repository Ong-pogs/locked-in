import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VillagePage from '@/app/village/page';

vi.mock('@/app/village/VillageScene', () => ({
  default: () => <div>desktop village</div>,
}));
vi.mock('@/app/village/MobileHub', () => ({
  MobileHub: () => <div>mobile village</div>,
}));

describe('VillagePage heading hierarchy', () => {
  it('renders one server-side level-one launch promise for both responsive layouts', () => {
    render(<VillagePage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Stop collecting courses. Finish one.' }),
    ).toBeInTheDocument();
  });
});
