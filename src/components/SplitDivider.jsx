import { useState } from 'react';
import './SplitDivider.css';

export default function SplitDivider({ type, onSplit, onMerge }) {
  const [hovered, setHovered] = useState(false);

  if (type === 'between-legs') {
    return (
      <div className="split-divider between-legs">
        <div className="split-line" />
        {onMerge && (
          <button className="split-action merge-btn" onClick={onMerge}>
            Merge
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="split-divider within-leg"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="split-line" />
      {hovered && onSplit && (
        <button className="split-action split-btn" onClick={onSplit}>
          Split
        </button>
      )}
    </div>
  );
}
