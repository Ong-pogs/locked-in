// Pixel-art crest: the Locked In logo (16 x 19 grid, one char per pixel, '.' is empty).
// Same grid as public/images/logo.svg and the app icons. The splash animates it cell by cell.
export const SHIELD_ROWS = [
  '.GGGGGGGGGGGGGG.',
  'GAAAAAAAAAAAAAAG',
  'GAVVVVVVVVVVVVAG',
  'GAVTVVVVVVVVVVAG',
  'GAVVVVVVVVVVVVAG',
  'GAVVVVVVVVVVVTAG',
  'GAVVVVVVVVVVVVAG',
  'GAVVVVVVVVVVVVAG',
  'GAVVVVVVVVVVVVAG',
  'GAVVVVVVVVVVVVAG',
  'GAvVVVVVVVVVVVAG',
  'GAvVVVVVVVVVVVAG',
  '.GAvVVVVVVVVVAG.',
  '.GAvvVVVVVVVvAG.',
  '..GAvvVVVVVvAG..',
  '...GAvvVVvvAG...',
  '....GAAvvAAG....',
  '.....GGAAGG.....',
  '.......GG.......',
] as const;

export const FLAME_ROWS = [
  '....O...',
  '...OO...',
  '...OOO..',
  '..OOOO..',
  '..OOGOO.',
  '.OOGGOO.',
  '.OGGGGO.',
  'OOGGYGGO',
  'OGGYYYGO',
  'OGYYYYGO',
  '.OGYYGO.',
  '..OOOO..',
] as const;

// The flame is stamped onto the shield here ('.' keeps the shield pixel underneath).
export const FLAME_OFFSET = { row: 3, col: 4 } as const;

export const PALETTE = {
  G: '#FFD580',
  A: '#D4A04A',
  V: '#2a1650',
  v: '#1b0f36',
  O: '#E8845A',
  Y: '#FFF1C2',
  T: '#2AE8D4',
  background: '#06060C',
} as const;

type CrestSymbol = Exclude<keyof typeof PALETTE, 'background'>;
export type CrestCellKind = 'flame' | 'border' | 'field';

export interface CrestCell {
  row: number;
  col: number;
  color: (typeof PALETTE)[CrestSymbol];
  kind: CrestCellKind;
}

// Every filled pixel with its color and role: flame (from the stamp), border (G/A), or field (V/v/T).
export function crestCells(): CrestCell[] {
  const grid = SHIELD_ROWS.map((row) => [...row]);
  const flameCells = new Set<string>();

  FLAME_ROWS.forEach((row, flameRow) => {
    [...row].forEach((symbol, flameCol) => {
      if (symbol === '.') return;

      const rowIndex = FLAME_OFFSET.row + flameRow;
      const colIndex = FLAME_OFFSET.col + flameCol;
      grid[rowIndex][colIndex] = symbol;
      flameCells.add(`${rowIndex},${colIndex}`);
    });
  });

  return grid.flatMap((row, rowIndex) =>
    row.flatMap((symbol, colIndex) => {
      if (symbol === '.') return [];

      const crestSymbol = symbol as CrestSymbol;
      const kind = flameCells.has(`${rowIndex},${colIndex}`)
        ? 'flame'
        : crestSymbol === 'G' || crestSymbol === 'A'
          ? 'border'
          : 'field';

      return [{ row: rowIndex, col: colIndex, color: PALETTE[crestSymbol], kind }];
    }),
  );
}
