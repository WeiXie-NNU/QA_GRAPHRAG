"""
向量存储模块 - 简单的向量检索实现

使用 FAISS 作为本地向量存储，支持文档加载和相似度检索
"""

import os
from typing import List, Optional
from pathlib import Path

from langchain_core.documents import Document

from config import get_embeddings


# ============================================================
# 向量存储路径配置
# ============================================================

# 默认向量存储目录
_agent_dir = os.path.dirname(__file__)
DEFAULT_CACHE_DIR = os.path.join(_agent_dir, "cache")
DEFAULT_INDEX_NAME = "naive_rag_index"


# ============================================================
# 向量存储类
# ============================================================

class SimpleVectorStore:
    """
    简单的向量存储封装
    
    特性:
    - 使用 FAISS 进行高效相似度搜索
    - 支持持久化存储和加载
    - 提供简单的文档添加和检索接口
    """
    
    def __init__(
        self, 
        cache_dir: str = DEFAULT_CACHE_DIR,
        index_name: str = DEFAULT_INDEX_NAME
    ):
        """
        初始化向量存储
        
        参数:
            cache_dir: 缓存目录路径
            index_name: 索引名称
        """
        self.cache_dir = cache_dir
        self.index_name = index_name
        self.index_path = os.path.join(cache_dir, index_name)
        self.embeddings = get_embeddings()
        self._vectorstore = None
        
        # 确保缓存目录存在
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
    
    # --------------------------------------------------------
    # 索引管理
    # --------------------------------------------------------
    
    def load_or_create(self) -> bool:
        """
        加载已有索引或创建新索引
        
        返回:
            bool: 是否成功加载已有索引
        """
        from langchain_community.vectorstores import FAISS
        
        if os.path.exists(self.index_path):
            try:
                self._vectorstore = FAISS.load_local(
                    self.index_path, 
                    self.embeddings,
                    allow_dangerous_deserialization=True
                )
                return True
            except Exception as e:
                print(f"加载索引失败: {e}")
        
        # 创建空索引（需要至少一个文档）
        self._vectorstore = None
        return False
    
    def save(self):
        """保存索引到磁盘"""
        if self._vectorstore:
            self._vectorstore.save_local(self.index_path)
    
    # --------------------------------------------------------
    # 文档操作
    # --------------------------------------------------------
    
    def add_documents(self, documents: List[Document]):
        """
        添加文档到向量存储
        
        参数:
            documents: 文档列表
        """
        from langchain_community.vectorstores import FAISS
        
        if not documents:
            return
        
        if self._vectorstore is None:
            # 首次添加，创建新的向量存储
            self._vectorstore = FAISS.from_documents(
                documents, 
                self.embeddings
            )
        else:
            # 追加到现有存储
            self._vectorstore.add_documents(documents)
    
    def add_texts(self, texts: List[str], metadatas: Optional[List[dict]] = None):
        """
        添加文本到向量存储
        
        参数:
            texts: 文本列表
            metadatas: 元数据列表（可选）
        """
        documents = []
        for i, text in enumerate(texts):
            metadata = metadatas[i] if metadatas and i < len(metadatas) else {}
            documents.append(Document(page_content=text, metadata=metadata))
        
        self.add_documents(documents)
    
    # --------------------------------------------------------
    # 检索操作
    # --------------------------------------------------------
    
    def search(self, query: str, k: int = 4) -> List[Document]:
        """
        相似度搜索
        
        参数:
            query: 查询文本
            k: 返回结果数量
            
        返回:
            List[Document]: 相似文档列表
        """
        if self._vectorstore is None:
            return []
        
        return self._vectorstore.similarity_search(query, k=k)
    
    def search_with_scores(self, query: str, k: int = 4) -> List[tuple]:
        """
        带分数的相似度搜索
        
        参数:
            query: 查询文本
            k: 返回结果数量
            
        返回:
            List[tuple]: (文档, 分数) 元组列表
        """
        if self._vectorstore is None:
            return []
        
        return self._vectorstore.similarity_search_with_score(query, k=k)
    
    # --------------------------------------------------------
    # 状态查询
    # --------------------------------------------------------
    
    @property
    def is_empty(self) -> bool:
        """检查存储是否为空"""
        return self._vectorstore is None
    
    @property
    def doc_count(self) -> int:
        """获取文档数量（估计值）"""
        if self._vectorstore is None:
            return 0
        try:
            return self._vectorstore.index.ntotal
        except:
            return 0


# ============================================================
# 便捷函数
# ============================================================

# 全局单例
_default_store: Optional[SimpleVectorStore] = None


def get_vectorstore() -> SimpleVectorStore:
    """获取默认向量存储实例（单例）"""
    global _default_store
    if _default_store is None:
        _default_store = SimpleVectorStore()
        _default_store.load_or_create()
    return _default_store


def search_documents(query: str, k: int = 4) -> str:
    """
    便捷函数：搜索相关文档并返回拼接的文本
    
    参数:
        query: 查询文本
        k: 返回结果数量
        
    返回:
        str: 拼接后的文档内容
    """
    store = get_vectorstore()
    docs = store.search(query, k=k)
    
    if not docs:
        return "未找到相关文档。"
    
    # 格式化输出
    result_parts = []
    for i, doc in enumerate(docs, 1):
        source = doc.metadata.get("source", "未知来源")
        result_parts.append(f"【文档 {i}】来源: {source}\n{doc.page_content}")
    
    return "\n\n---\n\n".join(result_parts)


# ============================================================
# 模块测试
# ============================================================

if __name__ == "__main__":
    print("测试向量存储模块...")
    
    # 创建测试存储
    store = SimpleVectorStore(index_name="test_index")
    
    # 添加测试文档
    test_docs = [
        "知识图谱是一种结构化的知识表示方法，用于描述实体及其关系。",
        "GraphRAG 结合了图数据库和检索增强生成技术。",
        "LangChain 是一个用于构建 LLM 应用的框架。",
    ]
    
    print(f"添加 {len(test_docs)} 个测试文档...")
    store.add_texts(test_docs)
    
    # 测试搜索
    query = "什么是知识图谱"
    print(f"\n搜索: {query}")
    results = store.search(query, k=2)
    for i, doc in enumerate(results, 1):
        print(f"  结果 {i}: {doc.page_content[:50]}...")
    
    print(f"\n文档总数: {store.doc_count}")
