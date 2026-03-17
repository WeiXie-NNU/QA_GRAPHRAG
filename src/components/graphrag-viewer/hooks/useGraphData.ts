/**
 * 图数据转换 Hook
 * 移植自 graphrag-visualizer 项目
 * 
 * 将原始数据转换为力导向图格式
 */

import { useMemo } from "react";
import type {
  Entity,
  Relationship,
  Document,
  TextUnit,
  Community,
  CommunityReport,
  Covariate,
  CustomGraphData,
  CustomNode,
  CustomLink,
} from "../models/types";

interface UseGraphDataOptions {
  includeDocuments: boolean;
  includeTextUnits: boolean;
  includeCommunities: boolean;
  includeCovariates: boolean;
}

const useGraphData = (
  entities: Entity[],
  relationships: Relationship[],
  documents: Document[],
  textunits: TextUnit[],
  communities: Community[],
  communityReports: CommunityReport[],
  covariates: Covariate[],
  options: UseGraphDataOptions
): CustomGraphData => {
  const {
    includeDocuments,
    includeTextUnits,
    includeCommunities,
    includeCovariates,
  } = options;

  const graphData = useMemo(() => {
    // 创建节点 Map
    const nodesMap: Record<string, CustomNode> = {};
    const nodes: CustomNode[] = [];
    const links: CustomLink[] = [];

    // 1. Entity 节点
    entities.forEach((entity) => {
      const node: CustomNode = {
        uuid: entity.id,
        id: entity.title,
        name: entity.title,
        title: entity.title,
        type: entity.type,
        description: entity.description,
        human_readable_id: entity.human_readable_id,
        text_unit_ids: entity.text_unit_ids,
        neighbors: [],
        links: [],
      };
      nodesMap[node.id] = node;
      nodes.push(node);
    });

    // 2. Relationship 链接
    relationships.forEach((rel) => {
      if (nodesMap[rel.source] && nodesMap[rel.target]) {
        links.push({
          source: rel.source,
          target: rel.target,
          type: rel.type || "RELATED",
          weight: rel.weight,
          description: rel.description,
          text_unit_ids: rel.text_unit_ids,
          id: rel.id,
          human_readable_id: rel.human_readable_id,
          combined_degree: rel.combined_degree,
        });
      }
    });

    // 3. Document 节点
    if (includeDocuments) {
      documents.forEach((doc) => {
        const node: CustomNode = {
          uuid: doc.id,
          id: doc.id,
          name: doc.title,
          title: doc.title,
          type: "RAW_DOCUMENT",
          text: doc.text,
          text_unit_ids: doc.text_unit_ids,
          human_readable_id: doc.human_readable_id,
          neighbors: [],
          links: [],
        };
        nodesMap[node.id] = node;
        nodes.push(node);
      });

      // 添加 TextUnit -> Document 链接
      if (includeTextUnits) {
        textunits.forEach((tu) => {
          (tu.document_ids || []).forEach((docId) => {
            if (nodesMap[tu.id] && nodesMap[docId]) {
              links.push({
                source: tu.id,
                target: docId,
                type: "PART_OF",
                id: `${tu.id}-${docId}`,
              });
            }
          });
        });
      }
    }

    // 4. TextUnit 节点
    if (includeTextUnits) {
      textunits.forEach((tu) => {
        const node: CustomNode = {
          uuid: tu.id,
          id: tu.id,
          name: `Chunk-${tu.human_readable_id || tu.id.slice(0, 8)}`,
          title: `Chunk-${tu.human_readable_id || tu.id.slice(0, 8)}`,
          type: "CHUNK",
          text: tu.text,
          human_readable_id: tu.human_readable_id,
          neighbors: [],
          links: [],
        };
        nodesMap[node.id] = node;
        nodes.push(node);

        // TextUnit -> Entity 链接
        (tu.entity_ids || []).forEach((entityId) => {
          // entity_ids 存的是 title
          const entityNode = entities.find((e) => e.id === entityId);
          if (entityNode && nodesMap[entityNode.title]) {
            links.push({
              source: tu.id,
              target: entityNode.title,
              type: "HAS_ENTITY",
              id: `${tu.id}-${entityNode.title}`,
            });
          }
        });
      });
    }

    // 5. Community 节点
    if (includeCommunities) {
      communityReports.forEach((report) => {
        const node: CustomNode = {
          uuid: report.id,
          id: report.id,
          name: report.title,
          title: report.title,
          type: "COMMUNITY",
          summary: report.summary,
          human_readable_id: report.human_readable_id,
          findings: report.findings,
          neighbors: [],
          links: [],
        };
        nodesMap[node.id] = node;
        nodes.push(node);

        // Community -> Finding 节点
        (report.findings || []).forEach((finding, idx) => {
          const findingNode: CustomNode = {
            uuid: `${report.id}-finding-${idx}`,
            id: `${report.id}-finding-${idx}`,
            name: `Finding-${idx + 1}`,
            title: finding.summary?.slice(0, 50) || `Finding-${idx + 1}`,
            type: "FINDING",
            summary: finding.summary,
            explanation: finding.explanation,
            neighbors: [],
            links: [],
          };
          nodesMap[findingNode.id] = findingNode;
          nodes.push(findingNode);

          links.push({
            source: report.id,
            target: findingNode.id,
            type: "HAS_FINDING",
            id: `${report.id}-finding-${idx}`,
          });
        });
      });

      // Entity -> Community 链接
      communities.forEach((community) => {
        const report = communityReports.find(
          (r) => r.community === community.community
        );
        if (report) {
          (community.entity_ids || []).forEach((entityId) => {
            const entityNode = entities.find((e) => e.id === entityId);
            if (entityNode && nodesMap[entityNode.title] && nodesMap[report.id]) {
              links.push({
                source: entityNode.title,
                target: report.id,
                type: "IN_COMMUNITY",
                id: `${entityNode.title}-${report.id}`,
              });
            }
          });
        }
      });
    }

    // 6. Covariate 节点
    if (includeCovariates && includeTextUnits) {
      covariates.forEach((cov) => {
        const node: CustomNode = {
          uuid: cov.id,
          id: cov.id,
          name: cov.subject_id || cov.type || `Covariate-${cov.human_readable_id}`,
          title: cov.subject_id || cov.type || `Covariate-${cov.human_readable_id}`,
          type: "COVARIATE",
          covariate_type: cov.covariate_type,
          description: cov.description,
          human_readable_id: cov.human_readable_id,
          neighbors: [],
          links: [],
        };
        nodesMap[node.id] = node;
        nodes.push(node);

        // TextUnit -> Covariate 链接
        if (cov.text_unit_id && nodesMap[cov.text_unit_id]) {
          links.push({
            source: cov.text_unit_id,
            target: cov.id,
            type: "HAS_COVARIATE",
            id: `${cov.text_unit_id}-${cov.id}`,
          });
        }
      });
    }

    // 7. 建立邻居关系
    links.forEach((link) => {
      const sourceNode = nodesMap[link.source as string];
      const targetNode = nodesMap[link.target as string];
      if (sourceNode && targetNode) {
        if (!sourceNode.neighbors!.includes(targetNode)) {
          sourceNode.neighbors!.push(targetNode);
        }
        if (!targetNode.neighbors!.includes(sourceNode)) {
          targetNode.neighbors!.push(sourceNode);
        }
        if (!sourceNode.links!.includes(link)) {
          sourceNode.links!.push(link);
        }
        if (!targetNode.links!.includes(link)) {
          targetNode.links!.push(link);
        }
      }
    });

    return { nodes, links };
  }, [
    entities,
    relationships,
    documents,
    textunits,
    communities,
    communityReports,
    covariates,
    includeDocuments,
    includeTextUnits,
    includeCommunities,
    includeCovariates,
  ]);

  return graphData;
};

export default useGraphData;
