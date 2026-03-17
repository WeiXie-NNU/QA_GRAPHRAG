import { lazy, Suspense } from "react";

const GraphRAGVisualizer = lazy(() =>
  import("../components/graphrag-viewer").then((module) => ({
    default: module.GraphRAGVisualizer,
  }))
);

export function GraphPage() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Loading GraphRAG Viewer...</div>}>
      <GraphRAGVisualizer />
    </Suspense>
  );
}

export default GraphPage;
