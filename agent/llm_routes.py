from typing import Any, Callable

from pydantic import BaseModel


def register_llm_routes(
    app: Any,
    get_supported_models: Callable[[], Any],
    get_llm_model: Callable[[], str],
    set_llm_model: Callable[[str], None],
) -> None:
    class LLMModelRequest(BaseModel):
        model: str

    @app.get("/api/llm/models")
    async def get_llm_models():
        """获取支持的 LLM 模型列表"""
        return {
            "models": get_supported_models(),
            "current": get_llm_model(),
        }

    @app.get("/api/llm/current")
    async def get_current_llm_model():
        """获取当前使用的 LLM 模型"""
        return {"model": get_llm_model()}

    @app.post("/api/llm/set-model")
    async def set_current_llm_model(request: LLMModelRequest):
        """设置当前使用的 LLM 模型"""
        model = request.model
        set_llm_model(model)
        return {
            "success": True,
            "model": model,
            "message": f"LLM 模型已切换到: {model}",
        }
