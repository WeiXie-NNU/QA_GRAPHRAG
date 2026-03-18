def get_llm(model="gpt-4o-mini"):
    from langchain_openai import ChatOpenAI
    import os
    """获取LLM实例"""
    return ChatOpenAI(
        model=model,
        temperature=0,
        api_key=os.getenv("OPENAI_API_KEY"),
        base_url=os.getenv("OPENAI_API_BASE"),
    )
    
    

def askAI(USER_PROMPT,SYSTEM_PROMPT = None):
    """调用AI模型"""
    from langchain_core.messages import HumanMessage, SystemMessage
    
    llm = get_llm()
    if not SYSTEM_PROMPT:
        SYSTEM_PROMPT = "你是一个有帮助的助手。"
    messages = [
        SystemMessage(content=SYSTEM_PROMPT),
        HumanMessage(content=USER_PROMPT)
    ]

    response = llm.invoke(messages)
    response_text = response.content
    return response_text


def geocoding_CN(address,city=None):
    """中国地址地理编码，采用高德地图API"""
    import requests
    url = "https://restapi.amap.com/v3/geocode/geo"
    params = {
        "key": "8e9b46d9c04705843c4896fc30e2ee86",
        "address": address,
        "city": city if city else "全国"
    }
    response = requests.get(url, params=params)
    data = response.json()
    if data["status"] == "1" and data["geocodes"]:
        location = data["geocodes"][0]["location"]
        return location  # 返回经纬度字符串 "lng,lat"
    else:
        return None
    
