"""
GraphRAG 查询模块 - 集成微软 GraphRAG 进行知识图谱查询

使用 graphrag 构建的知识图谱进行本地搜索（Local Search）和全局搜索（Global Search）。
支持多个知识图谱动态切换，数据存储在 resources/repositories/<MODEL>/kg/output 目录下。
"""

import os
import sys
import asyncio
import pandas as pd
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
from dotenv import load_dotenv

from .repository_registry import get_knowledge_graph, get_repository_root, normalize_model_id

# 添加 cleanKG 路径以导入元数据管理器
_cleankg_path = Path(__file__).parent.parent.parent.parent / "cleanKG"
if _cleankg_path.exists() and str(_cleankg_path) not in sys.path:
    sys.path.insert(0, str(_cleankg_path))

# 加载环境变量
_current_dir = Path(__file__).parent
_project_root = _current_dir.parent.parent.parent.parent
_root_env_file = _project_root / ".env"

if _root_env_file.exists():
    load_dotenv(_root_env_file, override=False)
    print(f"[GraphRAG] 已加载项目环境变量: {_root_env_file}")

def get_kg_output_dir(kg_id: str = "prosail") -> Path:
    """
    获取指定知识图谱的输出目录
    
    Args:
        kg_id: 知识图谱ID ("prosail" | "lue")
    
    Returns:
        知识图谱输出目录路径
    """
    normalized = normalize_model_id(kg_id)
    kg = get_knowledge_graph(normalized)
    if kg and kg.output_dir.exists():
        return kg.output_dir

    # 常见部署下的兜底自动发现：resources/repositories/<MODEL>/kg/output
    candidates = []
    model_dir_name = normalized.upper()
    if normalized == "prosail":
        model_dir_name = "PROSAIL"
    elif normalized == "lue":
        model_dir_name = "LUE"
    candidates.append(get_repository_root() / model_dir_name / "kg" / "output")
    candidates.append(get_repository_root() / model_dir_name / "output")

    for p in candidates:
        if p.exists():
            return p

    raise FileNotFoundError(
        f"知识图谱输出目录不存在 (kg={normalized}): tried {[str(p) for p in candidates]}"
    )


class GraphRAGQueryEngine:
    """
    GraphRAG 查询引擎
    
    封装 graphrag 的本地搜索和全局搜索功能，用于知识图谱参数推理。
    使用单例模式和缓存来避免重复加载数据。
    支持多知识图谱动态切换。
    """
    
    # 类级别缓存 - 按 kg_id 分开存储，支持多知识图谱
    _shared_dataframes: Dict[str, Dict[str, pd.DataFrame]] = {}  # {kg_id: {df_name: df}}
    _shared_configs: Dict[str, Any] = {}  # {kg_id: config}
    _cache_loaded: Dict[str, bool] = {}  # {kg_id: bool}
    _cache_lock = None  # 用于线程安全
    
    @classmethod
    def is_cache_loaded(cls, kg_id: Optional[str] = None) -> bool:
        """
        检查缓存是否已加载
        
        Args:
            kg_id: 知识图谱ID，如果为None则检查是否有任何缓存
        """
        if kg_id:
            return cls._cache_loaded.get(kg_id, False)
        return any(cls._cache_loaded.values())
    
    @classmethod
    def preload_cache(cls, kg_id: Optional[str] = None, output_dir: Optional[Path] = None) -> bool:
        """
        预加载缓存（可在应用启动时调用）
        
        Args:
            kg_id: 知识图谱ID
            output_dir: GraphRAG 输出目录
            
        Returns:
            是否加载成功
        """
        cache_key = kg_id or "default"
        if cls._cache_loaded.get(cache_key, False):
            print(f"[GraphRAG] 缓存已存在 (kg={cache_key})，跳过预加载")
            return True
            
        try:
            print(f"[GraphRAG] 开始预加载缓存 (kg={cache_key})...")
            engine = cls(kg_id=kg_id, output_dir=output_dir)
            # 触发数据加载
            engine._load_parquet_files()
            engine._get_graphrag_config()
            print(f"[GraphRAG] 缓存预加载完成 (kg={cache_key})")
            return True
        except Exception as e:
            print(f"[GraphRAG] 缓存预加载失败 (kg={cache_key}): {e}")
            return False
    
    @classmethod
    def clear_cache(cls, kg_id: Optional[str] = None):
        """
        清除缓存（用于热重载或刷新数据）
        
        Args:
            kg_id: 知识图谱ID，如果为None则清除所有缓存
        """
        if kg_id:
            cls._shared_dataframes.pop(kg_id, None)
            cls._shared_configs.pop(kg_id, None)
            cls._cache_loaded.pop(kg_id, None)
            print(f"[GraphRAG] 缓存已清除 (kg={kg_id})")
        else:
            cls._shared_dataframes = {}
            cls._shared_configs = {}
            cls._cache_loaded = {}
            print("[GraphRAG] 所有缓存已清除")
    
    @classmethod
    def get_cache_info(cls, kg_id: Optional[str] = None) -> Dict[str, Any]:
        """
        获取缓存状态信息
        
        Args:
            kg_id: 知识图谱ID，如果为None则返回所有缓存信息
        """
        if kg_id:
            return {
                "kg_id": kg_id,
                "loaded": cls._cache_loaded.get(kg_id, False),
                "dataframes_count": len(cls._shared_dataframes.get(kg_id, {})),
                "dataframes_keys": list(cls._shared_dataframes.get(kg_id, {}).keys()),
                "config_loaded": kg_id in cls._shared_configs
            }
        return {
            "loaded_kgs": list(cls._cache_loaded.keys()),
            "cache_status": {k: v for k, v in cls._cache_loaded.items()},
            "total_dataframes": sum(len(v) for v in cls._shared_dataframes.values())
        }
    
    def __init__(
        self, 
        kg_id: Optional[str] = None,
        output_dir: Optional[Path] = None, 
        metadata_dir: Optional[Path] = None
    ):
        """
        初始化查询引擎
        
        Args:
            kg_id: 知识图谱ID（如 "prosail", "lue"），用于选择知识图谱
            output_dir: GraphRAG 输出目录路径，如果提供则覆盖 kg_id 的默认路径
            metadata_dir: 元数据目录路径，用于论文来源溯源
        """
        # 确定知识图谱ID和输出目录
        self.kg_id = kg_id or "prosail"  # 默认使用 PROSAIL
        self._cache_key = self.kg_id
        
        if output_dir:
            self.output_dir = output_dir
        else:
            self.output_dir = get_kg_output_dir(self.kg_id)
        
        self._config = None
        self._dataframes = {}
        self._initialized = False
        self.metadata_manager = None
        
        # 初始化元数据管理器（用于论文溯源）
        if metadata_dir:
            try:
                from metadata_tracer import create_metadata_manager
                self.metadata_manager = create_metadata_manager(str(metadata_dir))
                print(f"[GraphRAG] 元数据管理器已初始化: {metadata_dir}")
            except Exception as e:
                print(f"[GraphRAG] 元数据管理器初始化失败: {e}")
        
        # 检查输出目录是否存在
        if not self.output_dir.exists():
            raise FileNotFoundError(f"GraphRAG 输出目录不存在: {self.output_dir} (kg={self.kg_id})")
        
        # 使用类级别缓存（按 kg_id 分开）
        if GraphRAGQueryEngine._cache_loaded.get(self._cache_key, False):
            self._dataframes = GraphRAGQueryEngine._shared_dataframes.get(self._cache_key, {})
            self._config = GraphRAGQueryEngine._shared_configs.get(self._cache_key)
            self._initialized = True
            print(f"[GraphRAG] 使用缓存数据 (kg={self.kg_id})，跳过重新加载")
        else:
            print(f"[GraphRAG] 初始化查询引擎 (kg={self.kg_id})，数据目录: {self.output_dir}")
        
    def _load_parquet_files(self) -> Dict[str, pd.DataFrame]:
        """
        加载所有必要的 parquet 文件（使用类级别缓存，按 kg_id 分开）
        
        Returns:
            包含各种数据的 DataFrame 字典
        """
        # 优先使用实例缓存
        if self._dataframes:
            return self._dataframes
        
        # 其次使用类级别缓存（按 kg_id）
        if GraphRAGQueryEngine._cache_loaded.get(self._cache_key, False):
            cached = GraphRAGQueryEngine._shared_dataframes.get(self._cache_key)
            if cached:
                self._dataframes = cached
                return self._dataframes
            
        required_files = [
            "entities.parquet",
            "relationships.parquet",
            "communities.parquet",
            "text_units.parquet",
        ]

        optional_files = [
            "community_reports.parquet",
            "covariates.parquet",
        ]
        
        print(f"[GraphRAG] 首次加载数据文件 (kg={self.kg_id})...")
        
        for filename in required_files:
            filepath = self.output_dir / filename
            if not filepath.exists():
                raise FileNotFoundError(f"缺少必要的数据文件: {filepath}")
            key = filename.replace(".parquet", "")
            self._dataframes[key] = pd.read_parquet(filepath)
            print(f"[GraphRAG] 已加载 {filename}: {len(self._dataframes[key])} 条记录")
        
        for filename in optional_files:
            filepath = self.output_dir / filename
            if filepath.exists():
                key = filename.replace(".parquet", "")
                self._dataframes[key] = pd.read_parquet(filepath)
                print(f"[GraphRAG] 已加载 {filename}: {len(self._dataframes[key])} 条记录")
            else:
                key = filename.replace(".parquet", "")
                self._dataframes[key] = None

        # 部分知识图谱（如新迁移仓库）可能不包含 community_reports.parquet。
        # 这里做常见兼容：从 communities 派生一个最小可用的 community_reports。
        if self._dataframes.get("community_reports") is None:
            communities_df = self._dataframes.get("communities")
            if isinstance(communities_df, pd.DataFrame) and not communities_df.empty:
                derived = communities_df.copy()
                if "title" not in derived.columns:
                    derived["title"] = derived.get("community", derived.index.astype(str))
                if "summary" not in derived.columns:
                    derived["summary"] = derived.get("description", "")
                if "full_content" not in derived.columns:
                    derived["full_content"] = derived.get("summary", "")
                self._dataframes["community_reports"] = derived
                print(
                    f"[GraphRAG] 未找到 community_reports.parquet，已由 communities 派生 "
                    f"{len(derived)} 条 community_reports (kg={self.kg_id})"
                )
            else:
                self._dataframes["community_reports"] = pd.DataFrame(
                    columns=["title", "summary", "full_content", "rank"]
                )
                print(
                    f"[GraphRAG] 未找到 community_reports.parquet，且 communities 为空，"
                    f"已创建空 community_reports (kg={self.kg_id})"
                )
        
        # 保存到类级别缓存（按 kg_id）
        GraphRAGQueryEngine._shared_dataframes[self._cache_key] = self._dataframes
        GraphRAGQueryEngine._cache_loaded[self._cache_key] = True
        print(f"[GraphRAG] 数据已缓存 (kg={self.kg_id})，后续查询将直接使用缓存")
                
        return self._dataframes
    
    def _get_graphrag_config(self):
        """
        获取 GraphRAG 配置（使用类级别缓存，按 kg_id 分开）
        
        Returns:
            GraphRagConfig 对象
        """
        # 优先使用实例缓存
        if self._config:
            return self._config
        
        # 其次使用类级别缓存（按 kg_id）
        cached_config = GraphRAGQueryEngine._shared_configs.get(self._cache_key)
        if cached_config:
            self._config = cached_config
            return self._config
            
        try:
            from graphrag.config.load_config import load_config
            
            # 从 kg 目录加载 settings.yaml 配置
            kg_root = self.output_dir.parent  # kg/{kg_name}/ 目录
            settings_path = kg_root / "settings.yaml"
            
            if settings_path.exists():
                print(f"[GraphRAG] 从配置文件加载 (kg={self.kg_id}): {settings_path}")
                self._config = load_config(root_dir=kg_root)
                # 保存到类级别缓存（按 kg_id）
                GraphRAGQueryEngine._shared_configs[self._cache_key] = self._config
                print(f"[GraphRAG] 配置加载成功并已缓存 (kg={self.kg_id})")
            else:
                print(f"[GraphRAG] 配置文件不存在: {settings_path}")
                self._config = None
                
        except Exception as e:
            print(f"[GraphRAG] 配置加载失败 (kg={self.kg_id}): {e}")
            import traceback
            traceback.print_exc()
            self._config = None
            
        return self._config
    
    async def local_search(
        self, 
        query: str,
        community_level: int = 2,
        response_type: str = "Multiple Paragraphs"
    ) -> Tuple[Any, Any]:
        """
        执行本地搜索（Local Search）
        
        本地搜索基于实体的语义相似度，适合回答关于特定实体的问题。
        
        Args:
            query: 用户查询
            community_level: 社区级别
            response_type: 响应类型
            
        Returns:
            (响应文本, 上下文数据)
        """
        try:
            import graphrag.api as api
            
            # 加载数据
            dfs = self._load_parquet_files()
            config = self._get_graphrag_config()
            
            if config is None:
                print("[GraphRAG] 配置为空，使用回退搜索")
                return await self._fallback_local_search(query)
            
            # 检查向量存储是否存在
            lancedb_path = self.output_dir / "lancedb"
            if not lancedb_path.exists():
                print(f"[GraphRAG] 向量存储不存在: {lancedb_path}，使用回退搜索")
                return await self._fallback_local_search(query)
            
            response, context_data = await api.local_search(
                config=config,
                entities=dfs["entities"],
                communities=dfs["communities"],
                community_reports=dfs["community_reports"],
                text_units=dfs["text_units"],
                relationships=dfs["relationships"],
                covariates=dfs.get("covariates") if dfs.get("covariates") is not None else None,
                community_level=community_level,
                response_type=response_type,
                query=query,
            )
            
            return str(response) if not isinstance(response, str) else response, context_data
            
        except ImportError:
            print("[GraphRAG] graphrag 库未安装，使用回退方案")
            return await self._fallback_local_search(query)
        except Exception as e:
            print(f"[GraphRAG] 本地搜索失败: {e}")
            import traceback
            traceback.print_exc()
            # 使用回退搜索（基于关键词匹配）
            print("[GraphRAG] 切换到回退搜索模式")
            return await self._fallback_local_search(query)
    
    async def global_search(
        self,
        query: str,
        community_level: int = 2,
        response_type: str = "Multiple Paragraphs",
        dynamic_community_selection: bool = False
    ) -> Tuple[Any, Any]:
        """
        执行全局搜索（Global Search）
        
        全局搜索基于社区报告，适合回答需要整体理解的问题。
        
        Args:
            query: 用户查询
            community_level: 社区级别
            response_type: 响应类型
            dynamic_community_selection: 是否动态选择社区
            
        Returns:
            (响应文本, 上下文数据)
        """
        try:
            import graphrag.api as api
            
            # 加载数据
            dfs = self._load_parquet_files()
            config = self._get_graphrag_config()
            
            if config is None:
                print("[GraphRAG] 配置为空，使用回退搜索")
                return await self._fallback_global_search(query)
            
            response, context_data = await api.global_search(
                config=config,
                entities=dfs["entities"],
                communities=dfs["communities"],
                community_reports=dfs["community_reports"],
                community_level=community_level,
                dynamic_community_selection=dynamic_community_selection,
                response_type=response_type,
                query=query,
            )
            
            return str(response) if not isinstance(response, str) else response, context_data
            
        except ImportError:
            print("[GraphRAG] graphrag 库未安装，使用回退方案")
            return await self._fallback_global_search(query)
        except Exception as e:
            print(f"[GraphRAG] 全局搜索失败: {e}")
            import traceback
            traceback.print_exc()
            print("[GraphRAG] 切换到回退搜索模式")
            return await self._fallback_global_search(query)
    
    async def _fallback_local_search(self, query: str) -> Tuple[str, Dict[str, Any]]:
        """
        本地搜索的回退方案 - 使用简单的文本匹配
        
        当 graphrag 库不可用或搜索失败时使用。
        """
        dfs = self._load_parquet_files()
        
        # 简单的实体匹配
        entities_df = dfs["entities"]
        matched_entities = []
        
        query_lower = query.lower()
        for _, entity in entities_df.iterrows():
            name = str(entity.get("name") or "").lower()
            description = str(entity.get("description") or "").lower()
            if query_lower in name or query_lower in description or any(
                keyword in name or keyword in description 
                for keyword in query_lower.split()
            ):
                matched_entities.append({
                    "name": entity.get("name") or "未知",
                    "type": entity.get("type") or "未知类型",
                    "description": entity.get("description") or "",
                })
        
        # 构建响应
        if matched_entities:
            response = "找到以下相关实体:\n\n"
            for entity in matched_entities[:10]:
                response += f"- **{entity['name']}** ({entity['type']})\n"
                if entity['description']:
                    desc = str(entity['description'])[:200]
                    response += f"  {desc}...\n\n"
        else:
            response = "未找到与查询直接相关的实体。"
        
        # 提取来源文档
        source_documents = []
        text_units_df = dfs.get("text_units", pd.DataFrame())
        if not text_units_df.empty and matched_entities:
            # 过滤掉 None 值
            entity_names = [e["name"] for e in matched_entities if e.get("name")]
            for _, tu in text_units_df.iterrows():
                text_content = str(tu.get("text", "")).lower()
                if entity_names and any(name.lower() in text_content for name in entity_names):
                    doc_ids = tu.get("document_ids", [])
                    if isinstance(doc_ids, list):
                        source_documents.extend(doc_ids)
        source_documents = list(set(source_documents))  # 去重
        
        # 获取论文元数据
        paper_sources = []
        if self.metadata_manager and source_documents:
            for doc_id in source_documents[:5]:  # 最多显示5个来源
                citation_info = self.metadata_manager.get_citation(doc_id)
                if citation_info:
                    paper_sources.append({
                        "file_name": citation_info.file_name,
                        "title": citation_info.title,
                        "authors": citation_info.authors,
                        "doi": citation_info.doi,
                        "journal": citation_info.journal,
                        "year": citation_info.publication_date,
                        "citation": citation_info.format_gb7714()
                    })
        
        context_data = {
            "matched_entities": matched_entities,
            "source_documents": source_documents,
            "paper_sources": paper_sources,
            "total_entities": len(entities_df),
        }
        
        return response, context_data
    
    async def _fallback_global_search(self, query: str) -> Tuple[str, Dict[str, Any]]:
        """
        全局搜索的回退方案 - 使用社区报告的简单匹配
        
        当 graphrag 库不可用或搜索失败时使用。
        """
        dfs = self._load_parquet_files()
        
        # 简单的社区报告匹配
        reports_df = dfs["community_reports"]
        matched_reports = []
        
        query_lower = query.lower()
        for _, report in reports_df.iterrows():
            title = str(report.get("title") or "").lower()
            summary = str(report.get("summary") or "").lower()
            full_content = str(report.get("full_content") or "").lower()
            
            if any(keyword in title or keyword in summary or keyword in full_content
                   for keyword in query_lower.split()):
                matched_reports.append({
                    "title": report.get("title") or "未知标题",
                    "summary": report.get("summary") or "",
                    "full_content": report.get("full_content") or "",
                    "rank": report.get("rank", 0) or 0,
                })
        
        # 按 rank 排序
        matched_reports.sort(key=lambda x: x.get("rank", 0) or 0, reverse=True)
        
        # 构建响应
        if matched_reports:
            response = "基于知识图谱的分析结果:\n\n"
            for report in matched_reports[:5]:
                response += f"### {report['title']}\n\n"
                if report['summary']:
                    response += f"{report['summary']}\n\n"
        else:
            response = "未找到与查询相关的社区报告。"
        
        # 提取来源文档（从社区报告中）
        source_documents = []
        if matched_reports:
            for report in matched_reports:
                # 尝试从报告中提取来源
                if "text_unit_ids" in report:
                    text_unit_ids = report.get("text_unit_ids", [])
                    if text_unit_ids:
                        # 获取对应的 text units
                        text_units_df = self.get_text_units()
                        for tu_id in text_unit_ids:
                            matching_tu = text_units_df[text_units_df["id"] == tu_id]
                            if not matching_tu.empty:
                                doc_ids = matching_tu.iloc[0].get("document_ids", [])
                                if isinstance(doc_ids, list):
                                    source_documents.extend(doc_ids)
        source_documents = list(set(source_documents))  # 去重
        
        # 获取论文元数据
        paper_sources = []
        if self.metadata_manager and source_documents:
            for doc_id in source_documents:
                citation_info = self.metadata_manager.get_citation(doc_id)
                if citation_info:
                    paper_sources.append({
                        "file_name": citation_info.file_name,
                        "title": citation_info.title,
                        "authors": citation_info.authors,
                        "doi": citation_info.doi,
                        "journal": citation_info.journal,
                        "year": citation_info.publication_date,
                        "citation": citation_info.format_gb7714()
                    })
        
        context_data = {
            "matched_reports": matched_reports,
            "source_documents": source_documents,
            "paper_sources": paper_sources,  # 新增：论文来源元数据
            "total_reports": len(reports_df),
        }
        
        return response, context_data
    
    def get_entities(self) -> pd.DataFrame:
        """获取实体数据"""
        self._load_parquet_files()
        return self._dataframes.get("entities", pd.DataFrame())
    
    def get_relationships(self) -> pd.DataFrame:
        """获取关系数据"""
        self._load_parquet_files()
        return self._dataframes.get("relationships", pd.DataFrame())
    
    def get_communities(self) -> pd.DataFrame:
        """获取社区数据"""
        self._load_parquet_files()
        return self._dataframes.get("communities", pd.DataFrame())
    
    def get_community_reports(self) -> pd.DataFrame:
        """获取社区报告"""
        self._load_parquet_files()
        return self._dataframes.get("community_reports", pd.DataFrame())
    
    def get_text_units(self) -> pd.DataFrame:
        """获取文本单元"""
        self._load_parquet_files()
        return self._dataframes.get("text_units", pd.DataFrame())
    
    def search_entities_by_name(self, name: str) -> List[Dict[str, Any]]:
        """
        按名称搜索实体
        
        Args:
            name: 实体名称（支持模糊匹配）
            
        Returns:
            匹配的实体列表
        """
        entities_df = self.get_entities()
        name_lower = name.lower()
        
        results = []
        for _, entity in entities_df.iterrows():
            entity_name = str(entity.get("name", "")).lower()
            if name_lower in entity_name or entity_name in name_lower:
                results.append({
                    "id": entity.get("id"),
                    "name": entity.get("name"),
                    "type": entity.get("type"),
                    "description": entity.get("description"),
                })
        
        return results
    
    def get_entity_relationships(self, entity_name: str) -> List[Dict[str, Any]]:
        """
        获取实体的所有关系
        
        Args:
            entity_name: 实体名称
            
        Returns:
            关系列表
        """
        if not entity_name:
            return []
        
        relationships_df = self.get_relationships()
        name_lower = str(entity_name).lower()
        
        results = []
        for _, rel in relationships_df.iterrows():
            source = str(rel.get("source", "") or "").lower()
            target = str(rel.get("target", "") or "").lower()
            
            if name_lower in source or name_lower in target:
                results.append({
                    "source": rel.get("source"),
                    "target": rel.get("target"),
                    "type": rel.get("type"),
                    "description": rel.get("description"),
                    "weight": rel.get("weight", 1.0),
                })
        
        return results


# 全局实例
_graphrag_engine: Optional[GraphRAGQueryEngine] = None


def get_graphrag_engine() -> GraphRAGQueryEngine:
    """
    获取 GraphRAG 查询引擎的全局实例
    
    Returns:
        GraphRAGQueryEngine 实例
    """
    global _graphrag_engine
    if _graphrag_engine is None:
        _graphrag_engine = GraphRAGQueryEngine()
    return _graphrag_engine


async def local_search(query: str, kg_id: str = "prosail", **kwargs) -> Tuple[str, Dict[str, Any]]:
    """
    执行本地搜索（便捷函数）
    
    Args:
        query: 用户查询
        kg_id: 知识图谱ID (prosail/lue)
        **kwargs: 其他参数
        
    Returns:
        (响应文本, 上下文数据)
    """
    try:
        engine = GraphRAGQueryEngine(kg_id=kg_id)
        return await engine.local_search(query, **kwargs)
    except FileNotFoundError as e:
        print(f"[GraphRAG] 知识图谱不存在 (kg={kg_id}): {e}")
        # 返回空结果
        return f"知识图谱 '{kg_id}' 不存在或未初始化", {"error": str(e), "kg_id": kg_id}
    except Exception as e:
        print(f"[GraphRAG] Local Search 失败 (kg={kg_id}): {e}")
        import traceback
        traceback.print_exc()
        return f"Local Search 执行出错: {e}", {"error": str(e), "kg_id": kg_id}


async def global_search(query: str, kg_id: str = "prosail", **kwargs) -> Tuple[str, Dict[str, Any]]:
    """
    执行全局搜索（便捷函数）
    
    Args:
        query: 用户查询
        kg_id: 知识图谱ID (prosail/lue)
        **kwargs: 其他参数
        
    Returns:
        (响应文本, 上下文数据)
    """
    try:
        engine = GraphRAGQueryEngine(kg_id=kg_id)
        return await engine.global_search(query, **kwargs)
    except FileNotFoundError as e:
        print(f"[GraphRAG] 知识图谱不存在 (kg={kg_id}): {e}")
        # 返回空结果
        return f"知识图谱 '{kg_id}' 不存在或未初始化", {"error": str(e), "kg_id": kg_id}
    except Exception as e:
        print(f"[GraphRAG] Global Search 失败 (kg={kg_id}): {e}")
        import traceback
        traceback.print_exc()
        return f"Global Search 执行出错: {e}", {"error": str(e), "kg_id": kg_id}


# 测试代码
if __name__ == "__main__":
    async def test():
        engine = GraphRAGQueryEngine()
        
        # 测试获取实体
        entities = engine.get_entities()
        print(f"实体数量: {len(entities)}")
        if len(entities) > 0:
            print(f"实体列名: {entities.columns.tolist()}")
            print(f"前5个实体:")
            print(entities.head())
        
        # 测试本地搜索
        print("\n--- 测试本地搜索 ---")
        response, context = await engine.local_search("PROSAIL LAI 参数")
        print(f"响应: {response[:500]}...")
        
        # 测试全局搜索
        print("\n--- 测试全局搜索 ---")
        response, context = await engine.global_search("植被参数反演的主要方法")
        print(f"响应: {response[:500]}...")
    
    asyncio.run(test())
