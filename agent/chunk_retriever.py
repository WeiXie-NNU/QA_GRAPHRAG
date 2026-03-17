"""
Neo4j Chunk 检索模块

从 Neo4j 数据库中检索 __Chunk__ 节点，使用向量相似度搜索
"""

import os
import numpy as np
from typing import List, Dict, Any, Optional
from functools import lru_cache

from dotenv import load_dotenv

# 加载环境变量
_copilotkit_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_copilotkit_dir, ".env"))


# ============================================================
# Neo4j 配置
# ============================================================

NEO4J_URI = os.getenv("NEO4J_URI", "neo4j://localhost:7688")
NEO4J_USERNAME = os.getenv("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "")


# ============================================================
# Neo4j Chunk 检索器
# ============================================================

class ChunkRetriever:
    """
    从 Neo4j 检索 Chunk 的工具类
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        
        self.driver = None
        self.embeddings = None
        self._connect()
        self._initialized = True
    
    def _connect(self):
        """建立数据库连接并初始化 embeddings"""
        # 连接 Neo4j
        try:
            from neo4j import GraphDatabase
            self.driver = GraphDatabase.driver(
                NEO4J_URI,
                auth=(NEO4J_USERNAME, NEO4J_PASSWORD)
            )
            # 测试连接
            with self.driver.session() as session:
                session.run("RETURN 1")
            print(f"✅ Neo4j Chunk 检索器连接成功: {NEO4J_URI}")
        except Exception as e:
            print(f"⚠️ Neo4j 连接失败: {e}")
            self.driver = None
        
        # 初始化 Embeddings
        try:
            from config import get_embeddings
            self.embeddings = get_embeddings()
            print("✅ Embeddings 模型加载成功")
        except Exception as e:
            print(f"⚠️ Embeddings 加载失败: {e}")
            self.embeddings = None
    
    def _cosine_similarity(self, vec1, vec2) -> float:
        """计算余弦相似度"""
        if not isinstance(vec1, np.ndarray):
            vec1 = np.array(vec1)
        if not isinstance(vec2, np.ndarray):
            vec2 = np.array(vec2)
        
        dot_product = np.dot(vec1, vec2)
        norm_a = np.linalg.norm(vec1)
        norm_b = np.linalg.norm(vec2)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        return float(dot_product / (norm_a * norm_b))
    
    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        搜索与查询最相关的 Chunk
        
        参数:
            query: 查询文本
            top_k: 返回的最大结果数
            
        返回:
            List[Dict]: 包含 id, text, score 的结果列表
        """
        if not self.driver or not self.embeddings:
            return []
        
        try:
            # 生成查询的嵌入向量
            query_embedding = self.embeddings.embed_query(query)
            
            # 从 Neo4j 获取带 embedding 的 Chunk 节点
            with self.driver.session() as session:
                result = session.run("""
                    MATCH (c:__Chunk__)
                    WHERE c.embedding IS NOT NULL
                    RETURN c.id AS id, c.text AS text, c.embedding AS embedding
                    LIMIT 200
                """)
                chunks = [dict(record) for record in result]
            
            if not chunks:
                return []
            
            # 计算相似度并排序
            scored_chunks = []
            for chunk in chunks:
                embedding = chunk.get("embedding")
                if embedding:
                    score = self._cosine_similarity(query_embedding, embedding)
                    scored_chunks.append({
                        "id": chunk.get("id", "unknown"),
                        "text": chunk.get("text", ""),
                        "score": score
                    })
            
            # 按分数降序排序
            scored_chunks.sort(key=lambda x: x["score"], reverse=True)
            
            return scored_chunks[:top_k]
            
        except Exception as e:
            print(f"Chunk 检索错误: {e}")
            return []
    
    def search_formatted(self, query: str, top_k: int = 5) -> str:
        """
        搜索并返回格式化的结果字符串
        
        参数:
            query: 查询文本
            top_k: 返回的最大结果数
            
        返回:
            str: 格式化的检索结果
        """
        results = self.search(query, top_k)
        
        if not results:
            return "未找到相关文档。"
        
        # 格式化输出
        parts = []
        chunk_ids = []
        
        for i, item in enumerate(results, 1):
            chunk_id = item.get("id", "unknown")
            text = item.get("text", "")
            score = item.get("score", 0)
            
            if text:
                # 截取前500字符避免过长
                text_preview = text[:500] + "..." if len(text) > 500 else text
                parts.append(f"【文档片段 {i}】(相关度: {score:.2f})\nChunk ID: {chunk_id}\n{text_preview}")
                chunk_ids.append(chunk_id)
        
        result_text = "\n\n---\n\n".join(parts)
        
        # 添加引用信息
        if chunk_ids:
            refs = ", ".join([f"'{cid}'" for cid in chunk_ids[:5]])
            result_text += f"\n\n### 引用数据\n{{'data': {{'Chunks':[{refs}] }} }}"
        
        return result_text
    
    def close(self):
        """关闭连接"""
        if self.driver:
            self.driver.close()


# ============================================================
# 便捷函数
# ============================================================

@lru_cache(maxsize=1)
def get_chunk_retriever() -> ChunkRetriever:
    """获取 Chunk 检索器实例（单例）"""
    return ChunkRetriever()


def search_chunks(query: str, top_k: int = 5) -> str:
    """
    便捷函数：搜索相关 Chunk 并返回格式化文本
    
    参数:
        query: 查询文本
        top_k: 返回结果数量
        
    返回:
        str: 格式化的检索结果
    """
    retriever = get_chunk_retriever()
    return retriever.search_formatted(query, top_k)


# ============================================================
# 模块测试
# ============================================================

if __name__ == "__main__":
    print("测试 Neo4j Chunk 检索器...")
    
    retriever = get_chunk_retriever()
    
    if retriever.driver:
        # 测试搜索
        test_query = "LAI"
        print(f"\n测试查询: {test_query}")
        print("-" * 50)
        
        results = retriever.search(test_query, top_k=3)
        for r in results:
            print(f"ID: {r['id'][:20]}..., Score: {r['score']:.3f}")
            print(f"Text: {r['text'][:100]}...")
            print()
    else:
        print("Neo4j 连接失败，请检查配置")
