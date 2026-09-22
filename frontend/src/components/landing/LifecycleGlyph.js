// frontend/src/components/landing/LifecycleGlyph.js
/**
 * Purely illustrative hero visual — a compact version of the Propose → Approve
 * → Act → Outcome → Learn loop. Static copy, no API calls, no live data; the
 * full version with real labels lives in LifecycleDiagram further down the
 * page. Reuses the .agent-flow-line/.agent-breathe keyframes already defined
 * in index.css for AgentActivityPage so this doesn't introduce new
 * always-on animation loops.
 */

const NODES = [
  { cx: 90, cy: 40 },
  { cx: 210, cy: 90 },
  { cx: 180, cy: 210 },
  { cx: 60, cy: 230 },
  { cx: 30, cy: 110 },
];

const EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 0],
];

export default function LifecycleGlyph() {
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md rounded-3xl border border-hairline bg-panel/40 p-6 shadow-panel backdrop-blur-xl">
      <div className="absolute inset-0 rounded-3xl bg-cosmic-wash opacity-70" />
      <svg viewBox="0 0 240 260" className="relative h-full w-full">
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={NODES[a].cx}
            y1={NODES[a].cy}
            x2={NODES[b].cx}
            y2={NODES[b].cy}
            strokeWidth="1.5"
            strokeDasharray="4 6"
            className="agent-flow-line stroke-accent-bright/35"
          />
        ))}
        {NODES.map((node, i) => (
          <g key={i}>
            <circle
              cx={node.cx}
              cy={node.cy}
              r="16"
              className="agent-breathe fill-panel-raised stroke-accent/55"
              strokeWidth="1.5"
            />
            <circle cx={node.cx} cy={node.cy} r="4" className="fill-accent-bright" />
          </g>
        ))}
      </svg>
    </div>
  );
}
