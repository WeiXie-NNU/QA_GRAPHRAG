"""
知识图谱数据 API

从多个知识图谱（PROSAIL、LUE 等）中读取 parquet 数据，
提供给前端进行可视化展示。

主要功能：
1. 列出所有可用的知识图谱
2. 获取指定知识图谱的节点和边数据
3. 获取知识图谱统计信息
"""

import json
import pandas as pd
from pathlib import Path
from typing import Dict, List, Any, Optional
from .repository_registry import get_repository

def _kg_output_dir(kg_id: str) -> Optional[Path]:
    repo = get_repository(kg_id)
    if not repo:
        return None
    return repo.kg_output_dir


def get_available_kgs() -> List[Dict[str, Any]]:
    """
    获取所有可用的知识图谱列表
    
    Returns:
        包含每个知识图谱元信息的列表
    """
    kgs = []
    for kg_id in ("prosail", "lue"):
        output = _kg_output_dir(kg_id)
        output = output if output else Path("")
        enabled = output.exists() and (output / "entities.parquet").exists()
        if kg_id == "prosail":
            name = "PROSAIL 植被辐射传输模型"
            desc = "PROSAIL 辐射传输模型参数知识图谱，包含叶片生化参数和冠层结构参数"
        else:
            name = "光能利用率模型（LUE Model）"
            desc = "光能利用率模型参数知识图谱，包含生态系统生产力和碳通量参数"
            if not enabled:
                desc += "（数据尚未生成）"
        kgs.append({
            "id": kg_id,
            "name": name,
            "description": desc,
            "path": str(output),
            "enabled": enabled,
        })
    return kgs


def read_parquet_safe(file_path: Path) -> pd.DataFrame:
    """安全读取 parquet 文件"""
    try:
        if file_path.exists():
            return pd.read_parquet(file_path)
    except Exception as e:
        print(f"[GraphAPI] 读取 {file_path} 失败: {e}")
    return pd.DataFrame()


def get_graph_data(kg_id: str = "prosail") -> Dict[str, Any]:
    """
    获取指定知识图谱的完整数据
    
    Args:
        kg_id: 知识图谱 ID，默认为 "prosail"
        
    Returns:
        包含 nodes 和 edges 的图谱数据
    """
    output_dir = _kg_output_dir(kg_id)
    if output_dir is None:
        return {"nodes": [], "edges": [], "error": f"Unknown KG: {kg_id}"}
    
    if not output_dir.exists():
        return {"nodes": [], "edges": [], "error": f"Data directory not found: {output_dir}"}
    
    # 读取实体数据
    entities_df = read_parquet_safe(output_dir / "entities.parquet")
    relationships_df = read_parquet_safe(output_dir / "relationships.parquet")
    communities_df = read_parquet_safe(output_dir / "communities.parquet")
    community_reports_df = read_parquet_safe(output_dir / "community_reports.parquet")
    
    nodes = []
    edges = []
    node_id_map = {}  # 用于建立 entity id -> node index 映射
    
    # 处理实体节点
    if not entities_df.empty:
        for idx, row in entities_df.iterrows():
            node_id = row.get("id") or row.get("title") or f"entity_{idx}"
            node = {
                "id": str(node_id),
                "label": str(row.get("title", row.get("name", node_id))),
                "name": str(row.get("title", row.get("name", node_id))),
                "type": str(row.get("type", "ENTITY")),
                "description": str(row.get("description", "")) if pd.notna(row.get("description")) else "",
                "properties": {},
                "nodeType": "entity",
            }
            
            # 添加额外属性
            for col in ["degree", "community", "level", "human_readable_id"]:
                if col in row and pd.notna(row[col]):
                    node["properties"][col] = row[col] if not isinstance(row[col], float) else int(row[col])
            
            nodes.append(node)
            node_id_map[str(node_id)] = str(node_id)
            
            # 同时用 title 作为映射键（因为 relationships 可能使用 title）
            title = row.get("title", "")
            if title and pd.notna(title):
                node_id_map[str(title)] = str(node_id)
    
    # 处理关系边
    if not relationships_df.empty:
        for idx, row in relationships_df.iterrows():
            source = str(row.get("source", ""))
            target = str(row.get("target", ""))
            
            # 尝试映射到实际的节点 ID
            source_id = node_id_map.get(source, source)
            target_id = node_id_map.get(target, target)
            
            # 确保 source 和 target 存在
            if source_id and target_id:
                edge = {
                    "id": str(row.get("id", f"edge_{idx}")),
                    "from": source_id,
                    "to": target_id,
                    "source": source_id,
                    "target": target_id,
                    "label": str(row.get("description", "")[:50]) if pd.notna(row.get("description")) else "",
                    "type": str(row.get("type", "RELATED_TO")) if pd.notna(row.get("type")) else "RELATED_TO",
                    "weight": float(row.get("weight", 1.0)) if pd.notna(row.get("weight")) else 1.0,
                    "description": str(row.get("description", "")) if pd.notna(row.get("description")) else "",
                }
                edges.append(edge)
    
    # 处理社区节点（可选）
    if not community_reports_df.empty:
        for idx, row in community_reports_df.iterrows():
            community_id = f"community_{row.get('community', idx)}"
            node = {
                "id": community_id,
                "label": str(row.get("title", f"社区 {idx}")),
                "name": str(row.get("title", f"社区 {idx}")),
                "type": "COMMUNITY",
                "description": str(row.get("summary", "")) if pd.notna(row.get("summary")) else "",
                "properties": {
                    "level": int(row.get("level", 0)) if pd.notna(row.get("level")) else 0,
                    "rank": float(row.get("rank", 0)) if pd.notna(row.get("rank")) else 0,
                },
                "nodeType": "community",
            }
            nodes.append(node)
    
    return {
        "nodes": nodes,
        "edges": edges,
        "kg_id": kg_id,
        "meta": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "entity_count": len(entities_df) if not entities_df.empty else 0,
            "relationship_count": len(relationships_df) if not relationships_df.empty else 0,
            "community_count": len(community_reports_df) if not community_reports_df.empty else 0,
        }
    }


def get_graph_stats(kg_id: str = "prosail") -> Dict[str, Any]:
    """
    获取知识图谱统计信息
    
    Args:
        kg_id: 知识图谱 ID
        
    Returns:
        统计信息字典
    """
    graph_data = get_graph_data(kg_id)
    
    if "error" in graph_data:
        return {"error": graph_data["error"]}
    
    # 统计节点类型
    node_types: Dict[str, int] = {}
    for node in graph_data["nodes"]:
        node_type = node.get("type", "UNKNOWN")
        node_types[node_type] = node_types.get(node_type, 0) + 1
    
    # 统计边类型
    edge_types: Dict[str, int] = {}
    for edge in graph_data["edges"]:
        edge_type = edge.get("type", "UNKNOWN")
        edge_types[edge_type] = edge_types.get(edge_type, 0) + 1
    
    return {
        "kg_id": kg_id,
        "totalNodes": len(graph_data["nodes"]),
        "totalEdges": len(graph_data["edges"]),
        "nodeTypes": node_types,
        "edgeTypes": edge_types,
    }


def get_all_kgs_data() -> Dict[str, Any]:
    """
    获取所有知识图谱的数据
    
    Returns:
        所有知识图谱的数据和元信息
    """
    kgs = get_available_kgs()
    result = {
        "available_kgs": kgs,
        "graphs": {},
    }
    
    for kg in kgs:
        if kg.get("enabled"):
            result["graphs"][kg["id"]] = get_graph_data(kg["id"])
    
    return result


# CLI 测试
if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        action = sys.argv[1]
        kg_id = sys.argv[2] if len(sys.argv) > 2 else "prosail"
        
        if action == "list":
            print(json.dumps(get_available_kgs(), ensure_ascii=False, indent=2))
        elif action == "data":
            print(json.dumps(get_graph_data(kg_id), ensure_ascii=False, indent=2))
        elif action == "stats":
            print(json.dumps(get_graph_stats(kg_id), ensure_ascii=False, indent=2))
        elif action == "all":
            print(json.dumps(get_all_kgs_data(), ensure_ascii=False, indent=2))
    else:
        # 默认输出 PROSAIL 数据
        print(json.dumps(get_graph_data(), ensure_ascii=False))
