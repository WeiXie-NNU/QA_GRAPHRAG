import type { MutableRefObject } from "react";
import ForceGraph2D from "react-force-graph-2d";
import type { CustomGraphData, CustomLink, CustomNode } from "../models/types";

interface GraphCanvas2DProps {
  data: CustomGraphData;
  graphRef: MutableRefObject<any>;
  darkMode: boolean;
  showHighlight: boolean;
  showLabels: boolean;
  showLinkLabels: boolean;
  highlightNodes: Set<CustomNode>;
  highlightLinks: Set<CustomLink>;
  onNodeHover: ((node: CustomNode | null) => void) | undefined;
  onLinkHover: ((link: CustomLink | null) => void) | undefined;
  onNodeClick: (node: CustomNode) => void;
  onLinkClick: (link: CustomLink) => void;
  paintRing: (node: CustomNode, ctx: CanvasRenderingContext2D) => void;
  renderNodeLabel: (node: CustomNode, ctx: CanvasRenderingContext2D) => void;
}

const NODE_R = 8;

export default function GraphCanvas2D({
  data,
  graphRef,
  darkMode,
  showHighlight,
  showLabels,
  showLinkLabels,
  highlightNodes,
  highlightLinks,
  onNodeHover,
  onLinkHover,
  onNodeClick,
  onLinkClick,
  paintRing,
  renderNodeLabel,
}: GraphCanvas2DProps) {
  return (
    <ForceGraph2D
      ref={graphRef}
      graphData={data}
      nodeAutoColorBy="type"
      nodeRelSize={NODE_R}
      autoPauseRedraw={false}
      linkWidth={(link) => (showHighlight && highlightLinks.has(link as CustomLink) ? 5 : 1)}
      linkDirectionalParticles={showHighlight ? 4 : 0}
      linkDirectionalParticleWidth={(link) => (showHighlight && highlightLinks.has(link as CustomLink) ? 4 : 0)}
      nodeCanvasObjectMode={(node) => (showHighlight && highlightNodes.has(node as CustomNode) ? "before" : showLabels ? "after" : undefined)}
      nodeCanvasObject={(node, ctx) => {
        if (showHighlight && highlightNodes.has(node as CustomNode)) {
          paintRing(node as CustomNode, ctx);
        }
        if (showLabels) {
          renderNodeLabel(node as CustomNode, ctx);
        }
      }}
      linkCanvasObjectMode={() => (showLinkLabels ? "after" : undefined)}
      linkCanvasObject={(link, ctx) => {
        if (!showLinkLabels) return;
        const typedLink = link as CustomLink;
        const source = typedLink.source as CustomNode;
        const target = typedLink.target as CustomNode;
        if (!source.x || !target.x) return;
        ctx.font = "3px Sans-Serif";
        ctx.fillStyle = darkMode ? "lightgray" : "darkgray";
        ctx.fillText(typedLink.type || "", (source.x + target.x) / 2, (source.y! + target.y!) / 2);
      }}
      onNodeHover={showHighlight ? onNodeHover : undefined}
      onLinkHover={showHighlight ? onLinkHover : undefined}
      onNodeClick={onNodeClick}
      onLinkClick={onLinkClick}
      backgroundColor={darkMode ? "#0a0a0f" : "#ffffff"}
      linkColor={() => (darkMode ? "gray" : "lightgray")}
    />
  );
}
