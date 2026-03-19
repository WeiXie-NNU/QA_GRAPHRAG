from pathlib import Path
from typing import Any, Callable

import pandas as pd
from fastapi import Query


def _serialize_dataframe(df: pd.DataFrame, exclude_embedding: bool = True) -> list:
    """
    将 DataFrame 转换为 JSON 可序列化的列表

    Args:
        df: pandas DataFrame
        exclude_embedding: 是否排除嵌入向量列
    """
    import numpy as np

    # 需要排除的嵌入向量列
    embedding_cols = {
        "description_embedding",
        "graph_embedding",
        "text_embedding",
        "document_embedding",
        "embedding",
    }

    records = []
    for _, row in df.iterrows():
        record = {}
        for col, val in row.items():
            # 跳过嵌入向量列
            if exclude_embedding and col in embedding_cols:
                continue
            # 处理空值
            if val is None or (isinstance(val, float) and pd.isna(val)):
                record[col] = None
            elif isinstance(val, (np.integer,)):
                record[col] = int(val)
            elif isinstance(val, (np.floating,)):
                record[col] = float(val)
            elif isinstance(val, np.ndarray):
                # 数组转为列表，但限制长度
                if len(val) > 10:
                    record[col] = f"[array of {len(val)} elements]"
                else:
                    record[col] = val.tolist()
            elif isinstance(val, (list, tuple)):
                # 列表直接保留（如 entity_ids）
                record[col] = list(val) if len(val) <= 100 else f"[list of {len(val)} items]"
            elif isinstance(val, bytes):
                record[col] = f"[bytes of {len(val)} length]"
            else:
                record[col] = val
        records.append(record)
    return records


def _serialize_value(v):
    """将值转换为 JSON 可序列化的格式"""
    import numpy as np

    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return float(v)
    if isinstance(v, np.ndarray):
        # 跳过嵌入向量等大型数组（超过100个元素）
        if len(v) > 100:
            return None  # 直接跳过大型数组
        return v.tolist()
    if isinstance(v, (list, tuple)):
        if len(v) > 100:
            return None  # 直接跳过大型列表
        return [_serialize_value(x) for x in v]
    if isinstance(v, dict):
        return {k: _serialize_value(val) for k, val in v.items()}
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    # 其他类型转为字符串
    return str(v)


def register_graphrag_visual_routes(
    app: Any,
    get_repository: Callable[[str], Any],
) -> None:
    def _get_graphrag_output_dir(kg_id: str = "prosail") -> Path:
        repo = get_repository(kg_id)
        if not repo:
            raise ValueError(f"未知知识仓库: {kg_id}")
        if not repo.available:
            raise ValueError(f"知识仓库不可用: {kg_id} ({repo.status_reason})")
        return repo.kg_output_dir

    @app.get("/api/graphrag/data")
    async def get_graphrag_data(kg_id: str = Query("prosail", description="知识仓库ID，如 prosail/lue")):
        """
        获取 GraphRAG 知识图谱数据

        从 parquet 文件读取实体、关系、社区等数据
        """
        try:
            output_dir = _get_graphrag_output_dir(kg_id)
            if not output_dir.exists():
                return {"error": f"GraphRAG 输出目录不存在: {output_dir}"}

            result = {
                "entities": [],
                "relationships": [],
                "communities": [],
                "community_reports": [],
                "text_units": [],
                "documents": [],
                "covariates": [],
                "stats": {},
            }

            # 读取实体
            entities_file = output_dir / "entities.parquet"
            if entities_file.exists():
                df = pd.read_parquet(entities_file)
                result["entities"] = _serialize_dataframe(df)
                result["stats"]["entities"] = len(df)
                print(f"[GraphRAG API] 加载 entities: {len(df)} 条")

            # 读取关系
            relationships_file = output_dir / "relationships.parquet"
            if relationships_file.exists():
                df = pd.read_parquet(relationships_file)
                result["relationships"] = _serialize_dataframe(df)
                result["stats"]["relationships"] = len(df)
                print(f"[GraphRAG API] 加载 relationships: {len(df)} 条")

            # 读取社区
            communities_file = output_dir / "communities.parquet"
            if communities_file.exists():
                df = pd.read_parquet(communities_file)
                result["communities"] = _serialize_dataframe(df)
                result["stats"]["communities"] = len(df)
                print(f"[GraphRAG API] 加载 communities: {len(df)} 条")

            # 读取社区报告
            community_reports_file = output_dir / "community_reports.parquet"
            if community_reports_file.exists():
                df = pd.read_parquet(community_reports_file)
                result["community_reports"] = _serialize_dataframe(df)
                result["stats"]["community_reports"] = len(df)
                print(f"[GraphRAG API] 加载 community_reports: {len(df)} 条")

            # 读取文本单元
            text_units_file = output_dir / "text_units.parquet"
            if text_units_file.exists():
                df = pd.read_parquet(text_units_file)
                result["text_units"] = _serialize_dataframe(df)
                result["stats"]["text_units"] = len(df)
                print(f"[GraphRAG API] 加载 text_units: {len(df)} 条")

            # 读取文档
            documents_file = output_dir / "documents.parquet"
            if documents_file.exists():
                df = pd.read_parquet(documents_file)
                result["documents"] = _serialize_dataframe(df)
                result["stats"]["documents"] = len(df)
                print(f"[GraphRAG API] 加载 documents: {len(df)} 条")

            # 读取协变量
            covariates_file = output_dir / "covariates.parquet"
            if covariates_file.exists():
                df = pd.read_parquet(covariates_file)
                result["covariates"] = _serialize_dataframe(df)
                result["stats"]["covariates"] = len(df)
                print(f"[GraphRAG API] 加载 covariates: {len(df)} 条")

            return result

        except Exception as e:
            print(f"[GraphRAG API] 加载数据失败: {e}")
            import traceback

            traceback.print_exc()
            return {"error": str(e)}

    @app.get("/api/graphrag/graph")
    async def get_graphrag_graph(kg_id: str = Query("prosail", description="知识仓库ID，如 prosail/lue")):
        """
        获取用于可视化的图谱数据（节点和边）

        参考 graphrag-visualizer 项目的实现：
        - entities 转为节点，使用 title 作为 id（因为 relationships 中的 source/target 使用 title）
        - relationships 转为边
        - communities 转为节点
        """
        import numpy as np

        try:
            nodes = []
            edges = []
            node_ids = set()  # 用于去重和验证边

            # 需要排除的嵌入向量字段
            embedding_fields = {"description_embedding", "graph_embedding", "text_embedding"}
            _ = embedding_fields

            output_dir = _get_graphrag_output_dir(kg_id)

            # 读取实体作为节点
            entities_file = output_dir / "entities.parquet"
            if entities_file.exists():
                df = pd.read_parquet(entities_file)
                print(f"[GraphRAG API] entities 列: {list(df.columns)}")

                for _, row in df.iterrows():
                    # 使用 title 作为节点 id（graphrag-visualizer 的方式）
                    # 因为 relationships 中的 source/target 使用的是实体的 title
                    entity_title = row.get("title") or row.get("name") or str(row.get("id", ""))
                    entity_id = str(row.get("id", ""))

                    if not entity_title:
                        continue

                    node = {
                        "uuid": entity_id,
                        "id": entity_title,  # 使用 title 作为 id
                        "name": entity_title,
                        "title": entity_title,
                        "type": str(row.get("type", "ENTITY")),
                        "description": str(row.get("description", "") or ""),
                        "human_readable_id": int(row.get("human_readable_id", 0))
                        if row.get("human_readable_id") is not None and not pd.isna(row.get("human_readable_id"))
                        else 0,
                    }

                    # 添加 text_unit_ids（如果存在且不是嵌入向量）
                    text_unit_ids = row.get("text_unit_ids")
                    if text_unit_ids is not None and not isinstance(text_unit_ids, (np.ndarray,)) or (
                        isinstance(text_unit_ids, np.ndarray) and len(text_unit_ids) <= 100
                    ):
                        if isinstance(text_unit_ids, (list, np.ndarray)):
                            node["text_unit_ids"] = list(text_unit_ids) if len(text_unit_ids) <= 100 else []
                        else:
                            node["text_unit_ids"] = []
                    else:
                        node["text_unit_ids"] = []

                    nodes.append(node)
                    node_ids.add(entity_title)

            # 读取关系作为边
            relationships_file = output_dir / "relationships.parquet"
            if relationships_file.exists():
                df = pd.read_parquet(relationships_file)
                print(f"[GraphRAG API] relationships 列: {list(df.columns)}")

                for _, row in df.iterrows():
                    source = str(row.get("source", ""))
                    target = str(row.get("target", ""))

                    # 只添加两端节点都存在的边
                    if source in node_ids and target in node_ids:
                        edge = {
                            "id": str(row.get("id", "")),
                            "source": source,
                            "target": target,
                            "type": "RELATED",  # graphrag-visualizer 使用固定值
                            "weight": float(row.get("weight", 1.0))
                            if row.get("weight") is not None and not pd.isna(row.get("weight"))
                            else 1.0,
                            "description": str(row.get("description", "") or ""),
                            "human_readable_id": int(row.get("human_readable_id", 0))
                            if row.get("human_readable_id") is not None and not pd.isna(row.get("human_readable_id"))
                            else 0,
                        }

                        # combined_degree
                        combined_degree = row.get("combined_degree")
                        if combined_degree is not None and not pd.isna(combined_degree):
                            edge["combined_degree"] = int(combined_degree)

                        edges.append(edge)

            # 读取社区作为节点（可选）
            communities_file = output_dir / "communities.parquet"
            if communities_file.exists():
                df = pd.read_parquet(communities_file)
                print(f"[GraphRAG API] communities 列: {list(df.columns)}")

                for _, row in df.iterrows():
                    comm_id = row.get("id") or row.get("community", "")
                    comm_title = row.get("title") or f"Community {comm_id}"

                    node = {
                        "uuid": str(comm_id),
                        "id": f"community_{comm_id}",
                        "name": str(comm_title),
                        "title": str(comm_title),
                        "type": "COMMUNITY",
                        "description": str(row.get("summary", "") or ""),
                        "level": int(row.get("level", 0))
                        if row.get("level") is not None and not pd.isna(row.get("level"))
                        else 0,
                        "human_readable_id": int(row.get("human_readable_id", 0))
                        if row.get("human_readable_id") is not None and not pd.isna(row.get("human_readable_id"))
                        else 0,
                    }
                    nodes.append(node)

            print(f"[GraphRAG API] 图谱数据: {len(nodes)} 节点, {len(edges)} 边")

            return {
                "nodes": nodes,
                "links": edges,  # graphrag-visualizer 使用 links 而不是 edges
                "stats": {
                    "totalNodes": len(nodes),
                    "totalEdges": len(edges),
                },
            }

        except Exception as e:
            print(f"[GraphRAG API] 获取图谱数据失败: {e}")
            import traceback

            traceback.print_exc()
            return {"error": str(e), "nodes": [], "links": []}
