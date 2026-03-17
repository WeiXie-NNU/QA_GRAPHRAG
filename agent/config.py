"""
配置模块 - 管理 LLM 和 Embedding 模型配置

使用最新版 langchain-openai API，支持环境变量配置
"""

import os
from functools import lru_cache
from dotenv import load_dotenv

# ============================================================
# 环境变量加载
# ============================================================

# 加载 copilotkit_frontend 目录下的 .env 文件
_copilotkit_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_copilotkit_dir, ".env"))


# ============================================================
# 模型配置
# ============================================================

# OpenAI 兼容 API 配置（支持各种兼容接口）
# 兼容根目录 .env 的变量名
OPENAI_API_KEY = "sk-NJS5hn3VqbLV5sJD28810b686f35429dA575961c1e67029c"
OPENAI_API_BASE = "https://aihubmix.com/v1"



# 模型名称配置（兼容根目录 .env 的变量名）
LLM_MODEL = os.getenv("LLM_MODEL") or os.getenv("OPENAI_LLM_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL") or os.getenv("OPENAI_EMBEDDINGS_MODEL", "text-embedding-3-large")

# 模型参数
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.7"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "2048"))


# ============================================================
# 模型实例工厂（使用缓存避免重复创建）
# ============================================================

@lru_cache(maxsize=1)
def get_llm():
    """
    获取 LLM 实例（单例模式）
    
    返回:
        ChatOpenAI: 配置好的 LLM 实例
    """
    from langchain_openai import ChatOpenAI
    
    print("初始化 LLM 实例...")
    print(f"  模型: {LLM_MODEL}")
    print(f"  温度: {LLM_TEMPERATURE}")
    print(f"  最大令牌数: {LLM_MAX_TOKENS}")
    print(f"  API 基础地址: {OPENAI_API_BASE}")
    print(f"  API 密钥: {OPENAI_API_KEY[:4]}****{OPENAI_API_KEY[-4:]}")
    return ChatOpenAI(
        model=LLM_MODEL,
        temperature=LLM_TEMPERATURE,
        max_tokens=LLM_MAX_TOKENS,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_API_BASE,
        streaming=True,
    )


@lru_cache(maxsize=1)
def get_embeddings():
    """
    获取 Embedding 模型实例（单例模式）
    
    返回:
        OpenAIEmbeddings: 配置好的 Embedding 实例
    """
    from langchain_openai import OpenAIEmbeddings
    
    return OpenAIEmbeddings(
        model=EMBEDDING_MODEL,
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_API_BASE,
    )


# ============================================================
# 配置验证
# ============================================================

def validate_config() -> dict:
    """
    验证配置是否正确
    
    返回:
        dict: 验证结果，包含 valid 和 errors 字段
    """
    errors = []
    
    if not OPENAI_API_KEY:
        errors.append("OPENAI_API_KEY 未设置")
    
    if not LLM_MODEL:
        errors.append("LLM_MODEL 未设置")
    
    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "config": {
            "api_base": OPENAI_API_BASE,
            "llm_model": LLM_MODEL,
            "embedding_model": EMBEDDING_MODEL,
            "temperature": LLM_TEMPERATURE,
        }
    }


# ============================================================
# 模块测试
# ============================================================

if __name__ == "__main__":
    # 验证配置
    result = validate_config()
    print("配置验证结果:")
    print(f"  有效: {result['valid']}")
    if result['errors']:
        print(f"  错误: {result['errors']}")
    print(f"  配置: {result['config']}")
    
    # 测试 LLM
    if result['valid']:
        print("\n测试 LLM 连接...")
        try:
            llm = get_llm()
            response = llm.invoke("你好，请用一句话介绍自己")
            print(f"  LLM 响应: {response.content[:100]}...")
        except Exception as e:
            print(f"  LLM 错误: {e}")
