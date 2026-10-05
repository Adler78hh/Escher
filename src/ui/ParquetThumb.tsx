// Small preview picture of an Archimedean parquet, grown from its vertex configuration.

import { memo } from 'react';
import { growParquet } from '../parquets/archimedean';

const FILL: Record<number, string> = {
  3: '#f6c453',
  4: '#5fa8d3',
  6: '#8bc34a',
  8: '#e57373',
  12: '#b39ddb',
};

export const ParquetThumb = memo(function ParquetThumb({ vertex, size = 2.6 }: { vertex: number[]; size?: number }) {
  // Larger polygons need a larger window to show the pattern.
  const scale = Math.max(...vertex) >= 8 ? 1.6 : 1;
  const r = size * scale;
  const polys = growParquet(vertex, r + 2.5);
  return (
    <svg className="thumb" viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} aria-hidden="true">
      {polys.map((p, i) => (
        <polygon
          key={i}
          points={p.points.map((q) => `${q.x},${q.y}`).join(' ')}
          fill={FILL[p.sides] ?? '#ccc'}
          stroke="#333"
          strokeWidth={0.05 * scale}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
});
