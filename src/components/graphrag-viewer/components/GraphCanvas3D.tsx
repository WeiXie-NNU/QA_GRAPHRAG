import { useMemo, type MutableRefObject } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import SpriteText from "three-spritetext";
import type { CustomGraphData, CustomLink, CustomNode } from "../models/types";

interface GraphCanvas3DProps {
  data: CustomGraphData;
  graphRef: MutableRefObject<any>;
  darkMode: boolean;
  showHighlight: boolean;
  showLabels: boolean;
  showLinkLabels: boolean;
  highlightLinks: Set<CustomLink>;
  onNodeHover: ((node: CustomNode | null) => void) | undefined;
  onLinkHover: ((link: CustomLink | null) => void) | undefined;
  onNodeClick: (node: CustomNode) => void;
  onLinkClick: (link: CustomLink) => void;
}

const NODE_R = 8;

export default function GraphCanvas3D({
  data,
  graphRef,
  darkMode,
  showHighlight,
  showLabels,
  showLinkLabels,
  highlightLinks,
  onNodeHover,
  onLinkHover,
  onNodeClick,
  onLinkClick,
}: GraphCanvas3DProps) {
  const extraRenderers = useMemo(() => [new CSS2DRenderer() as any], []);
  const nodeThreeObject = (node: CustomNode) => {
    if (!showLabels) {
      return new THREE.Object3D();
    }

    try {
      const nodeEl = document.createElement("div");
      nodeEl.textContent = node.name || node.id;
      nodeEl.style.color = (node as any).color || "#ffffff";
      nodeEl.style.padding = "2px 4px";
      nodeEl.style.borderRadius = "4px";
      nodeEl.style.fontSize = "10px";
      nodeEl.className = "node-label";
      return new CSS2DObject(nodeEl);
    } catch {
      return new THREE.Object3D();
    }
  };

  return (
    <ForceGraph3D
      ref={graphRef}
      extraRenderers={extraRenderers}
      graphData={data}
      nodeAutoColorBy="type"
      nodeRelSize={NODE_R}
      linkWidth={(link) => (showHighlight && highlightLinks.has(link as CustomLink) ? 5 : 1)}
      linkDirectionalParticles={showHighlight ? 4 : 0}
      linkDirectionalParticleWidth={(link) => (showHighlight && highlightLinks.has(link as CustomLink) ? 4 : 0)}
      nodeThreeObject={nodeThreeObject}
      nodeThreeObjectExtend={true}
      onNodeHover={showHighlight ? onNodeHover : undefined}
      onLinkHover={showHighlight ? onLinkHover : undefined}
      onNodeClick={onNodeClick}
      onLinkClick={onLinkClick}
      backgroundColor={darkMode ? "#0a0a0f" : "#ffffff"}
      linkColor={() => (darkMode ? "lightgray" : "gray")}
      linkThreeObjectExtend={true}
      linkThreeObject={(link) => {
        if (!showLinkLabels) return new THREE.Object3D();
        const sprite = new SpriteText(`${(link as CustomLink).type}`);
        sprite.color = "lightgrey";
        sprite.textHeight = 1.5;
        return sprite;
      }}
      linkPositionUpdate={(sprite, { start, end }) => {
        if (!showLinkLabels) return;
        Object.assign(sprite.position, {
          x: start.x + (end.x - start.x) / 2,
          y: start.y + (end.y - start.y) / 2,
          z: start.z + (end.z - start.z) / 2,
        });
      }}
    />
  );
}
