"""
地理位置工具模块

提供:
1. Nominatim 地理编码服务
2. 地理区位特征补全
3. 气候/植被类型推断
"""

import asyncio
import httpx
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime
import math

from .state import GeoLocation, GeoCharacteristics


# ============================================================
# Nominatim 地理编码服务
# ============================================================

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org"
USER_AGENT = "PROSAIL-GraphRAG-Agent/1.0"


async def geocode_place(place_name: str, timeout: float = 10.0) -> Optional[GeoLocation]:
    """
    使用 Nominatim 进行地理编码
    
    Args:
        place_name: 地名
        timeout: 请求超时时间
    
    Returns:
        GeoLocation 对象，如果未找到则返回 None
    """
    if not place_name:
        return None
    
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                f"{NOMINATIM_BASE_URL}/search",
                params={
                    "q": place_name,
                    "format": "json",
                    "limit": 1,
                    "addressdetails": 1,
                },
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            results = response.json()
            
            if not results:
                print(f"[GEO] Nominatim 未找到: {place_name}")
                return None
            
            result = results[0]
            address = result.get("address", {})
            
            geo_location = GeoLocation(
                lat=float(result["lat"]),
                lon=float(result["lon"]),
                display_name=result.get("display_name", place_name),
                place_name=place_name,
                country=address.get("country"),
                state=address.get("state") or address.get("province"),
                city=address.get("city") or address.get("town") or address.get("village"),
                bounding_box=[float(x) for x in result.get("boundingbox", [])],
            )
            
            print(f"[GEO] 解析成功: {place_name} -> ({geo_location['lat']:.4f}, {geo_location['lon']:.4f})")
            return geo_location
            
        except httpx.TimeoutException:
            print(f"[GEO] Nominatim 请求超时: {place_name}")
            return None
        except Exception as e:
            print(f"[GEO] Nominatim 请求失败: {e}")
            return None


async def reverse_geocode(lat: float, lon: float, timeout: float = 10.0) -> Optional[GeoLocation]:
    """
    反向地理编码: 坐标 -> 地名
    
    Args:
        lat: 纬度
        lon: 经度
        timeout: 请求超时时间
    
    Returns:
        GeoLocation 对象
    """
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            response = await client.get(
                f"{NOMINATIM_BASE_URL}/reverse",
                params={
                    "lat": lat,
                    "lon": lon,
                    "format": "json",
                    "addressdetails": 1,
                },
                headers={"User-Agent": USER_AGENT},
            )
            response.raise_for_status()
            result = response.json()
            
            if "error" in result:
                return None
            
            address = result.get("address", {})
            
            return GeoLocation(
                lat=lat,
                lon=lon,
                display_name=result.get("display_name", ""),
                place_name=address.get("city") or address.get("town") or address.get("state", ""),
                country=address.get("country"),
                state=address.get("state") or address.get("province"),
                city=address.get("city") or address.get("town"),
                bounding_box=[float(x) for x in result.get("boundingbox", [])] if result.get("boundingbox") else None,
            )
            
        except Exception as e:
            print(f"[GEO] 反向编码失败: {e}")
            return None


# ============================================================
# 气候带推断
# ============================================================

def infer_climate_zone(lat: float, lon: float, elevation: Optional[float] = None) -> Dict[str, Any]:
    """
    基于坐标推断气候带
    
    简化的气候带分类:
    - 热带: 纬度 < 23.5°
    - 亚热带: 23.5° <= 纬度 < 35°
    - 温带: 35° <= 纬度 < 55°
    - 寒带/亚寒带: 纬度 >= 55°
    
    Args:
        lat: 纬度
        lon: 经度
        elevation: 海拔 (可选，用于修正)
    
    Returns:
        气候特征字典
    """
    abs_lat = abs(lat)
    
    # 基础气候带判断
    if abs_lat < 23.5:
        climate_zone = "tropical"
        zone_cn = "热带"
        base_temp = 25
        precip_pattern = "高"
    elif abs_lat < 35:
        climate_zone = "subtropical"
        zone_cn = "亚热带"
        base_temp = 18
        precip_pattern = "中高"
    elif abs_lat < 55:
        climate_zone = "temperate"
        zone_cn = "温带"
        base_temp = 12
        precip_pattern = "中等"
    else:
        climate_zone = "subarctic"
        zone_cn = "亚寒带"
        base_temp = 5
        precip_pattern = "低"
    
    # 海拔修正 (每升高 1000m 降温约 6°C)
    if elevation and elevation > 0:
        temp_adjustment = -6.0 * (elevation / 1000)
        base_temp += temp_adjustment
        
        # 高海拔区域的气候类型修正
        if elevation > 3000:
            climate_zone = "alpine"
            zone_cn = "高山"
    
    # 干湿度推断 (简化: 基于大陆性)
    # 距离海洋越远越干燥 (这里用简化逻辑)
    is_coastal = _is_coastal_region(lat, lon)
    humidity = "humid" if is_coastal else "semi-arid"
    humidity_cn = "湿润" if is_coastal else "半干旱"
    
    return {
        "climate_zone": climate_zone,
        "climate_zone_cn": zone_cn,
        "estimated_annual_temp": round(base_temp, 1),
        "humidity_type": humidity,
        "humidity_type_cn": humidity_cn,
        "precip_level": precip_pattern,
        "confidence": 0.7,  # 简化推断的置信度
    }


def _is_coastal_region(lat: float, lon: float) -> bool:
    """
    简化的海岸地区判断
    (实际应用中应使用地理数据库)
    """
    # 简化逻辑: 东亚/东南亚沿海
    if 100 < lon < 145 and 0 < lat < 45:
        return True
    # 欧洲西海岸
    if -10 < lon < 10 and 35 < lat < 60:
        return True
    # 美洲东西海岸
    if lon < -110 or lon > -70:
        return abs(lat) < 50
    return False


# ============================================================
# 植被类型推断
# ============================================================

def infer_vegetation_type(
    climate_zone: str,
    lat: float,
    lon: float,
    season: Optional[str] = None
) -> Dict[str, Any]:
    """
    基于气候带推断可能的植被类型
    
    Args:
        climate_zone: 气候带
        lat: 纬度
        lon: 经度
        season: 季节 (可选)
    
    Returns:
        植被特征字典
    """
    # 气候带到植被类型的映射
    climate_vegetation_map = {
        "tropical": {
            "primary_types": ["tropical_rainforest", "tropical_savanna"],
            "biome": "热带雨林/热带草原",
            "typical_lai": (4.0, 8.0),
            "typical_cab": (40, 70),
        },
        "subtropical": {
            "primary_types": ["subtropical_forest", "cropland"],
            "biome": "亚热带常绿林/农田",
            "typical_lai": (3.0, 6.0),
            "typical_cab": (30, 60),
        },
        "temperate": {
            "primary_types": ["temperate_forest", "grassland", "cropland"],
            "biome": "温带落叶林/草地",
            "typical_lai": (2.0, 5.0),
            "typical_cab": (25, 55),
        },
        "subarctic": {
            "primary_types": ["boreal_forest", "tundra"],
            "biome": "寒带针叶林/苔原",
            "typical_lai": (1.0, 3.0),
            "typical_cab": (15, 40),
        },
        "alpine": {
            "primary_types": ["alpine_meadow", "sparse_vegetation"],
            "biome": "高山草甸",
            "typical_lai": (0.5, 2.5),
            "typical_cab": (20, 45),
        },
    }
    
    veg_info = climate_vegetation_map.get(climate_zone, climate_vegetation_map["temperate"])
    
    # 季节性调整
    phenology_stage = _infer_phenology(lat, season)
    
    return {
        "vegetation_types": veg_info["primary_types"],
        "biome": veg_info["biome"],
        "typical_lai_range": veg_info["typical_lai"],
        "typical_cab_range": veg_info["typical_cab"],
        "phenology_stage": phenology_stage,
        "confidence": 0.6,
    }


def _infer_phenology(lat: float, season: Optional[str] = None) -> str:
    """
    推断物候期
    
    Args:
        lat: 纬度
        season: 季节
    
    Returns:
        物候期: dormant, green-up, maturity, senescence
    """
    if season is None:
        # 根据当前月份推断北半球季节
        month = datetime.now().month
        if month in [3, 4, 5]:
            season = "spring"
        elif month in [6, 7, 8]:
            season = "summer"
        elif month in [9, 10, 11]:
            season = "autumn"
        else:
            season = "winter"
    
    # 南半球季节相反
    if lat < 0:
        season_map = {"spring": "autumn", "summer": "winter", "autumn": "spring", "winter": "summer"}
        season = season_map.get(season, season)
    
    phenology_map = {
        "spring": "green-up",
        "summer": "maturity",
        "autumn": "senescence",
        "winter": "dormant",
    }
    
    return phenology_map.get(season, "maturity")


# ============================================================
# 综合地理特征补全
# ============================================================

async def enrich_geo_characteristics(
    geo_location: GeoLocation,
    llm=None,
    config=None
) -> GeoCharacteristics:
    """
    补全完整的地理区位特征
    
    结合规则推断和 LLM 补充
    
    Args:
        geo_location: 地理位置信息
        llm: LLM 实例 (可选，用于补充细节)
        config: 配置
    
    Returns:
        完整的地理区位特征
    """
    lat = geo_location["lat"]
    lon = geo_location["lon"]
    
    # 1. 气候推断
    climate_info = infer_climate_zone(lat, lon)
    climate_zone = climate_info["climate_zone"]
    
    # 2. 植被推断
    veg_info = infer_vegetation_type(climate_zone, lat, lon)
    
    # 3. 组装地理特征
    geo_chars = GeoCharacteristics(
        # 气候特征
        climate_zone=climate_info["climate_zone_cn"],
        koppen_class=None,  # 需要更精确的数据
        annual_temp=climate_info["estimated_annual_temp"],
        annual_precip=None,  # 需要更精确的数据
        humidity=climate_info["humidity_type_cn"],
        
        # 植被特征
        vegetation_type=veg_info["biome"],
        biome=veg_info["biome"],
        land_cover=None,
        phenology_stage=veg_info["phenology_stage"],
        
        # 地形特征
        elevation=None,  # 需要 DEM 数据
        slope=None,
        aspect=None,
        terrain_type=None,
        
        # 土壤特征
        soil_type=None,
        soil_moisture=None,
        
        # 元数据
        season=_get_current_season(lat),
        data_source="rule-based inference",
    )
    
    print(f"[GEO] 特征补全完成: {geo_location['place_name']} - {climate_info['climate_zone_cn']}, {veg_info['biome']}")
    
    return geo_chars


def _get_current_season(lat: float) -> str:
    """获取当前季节"""
    month = datetime.now().month
    
    # 北半球季节
    if lat >= 0:
        if month in [3, 4, 5]:
            return "春季"
        elif month in [6, 7, 8]:
            return "夏季"
        elif month in [9, 10, 11]:
            return "秋季"
        else:
            return "冬季"
    else:
        # 南半球季节相反
        if month in [3, 4, 5]:
            return "秋季"
        elif month in [6, 7, 8]:
            return "冬季"
        elif month in [9, 10, 11]:
            return "春季"
        else:
            return "夏季"


# ============================================================
# 相似区域检索
# ============================================================

def find_similar_climate_regions(
    target_climate: str,
    target_lat: float,
    limit: int = 5
) -> List[Dict[str, Any]]:
    """
    查找气候相似的参考区域
    
    Args:
        target_climate: 目标气候类型
        target_lat: 目标纬度
        limit: 返回数量限制
    
    Returns:
        相似区域列表
    """
    # 预定义的参考区域数据库
    # 实际应用中应从知识图谱或数据库检索
    reference_regions = [
        {"name": "亚马逊雨林", "climate": "tropical", "lat": -3.0, "lon": -60.0},
        {"name": "刚果盆地", "climate": "tropical", "lat": 0.0, "lon": 20.0},
        {"name": "长江中下游", "climate": "subtropical", "lat": 30.0, "lon": 117.0},
        {"name": "珠江三角洲", "climate": "subtropical", "lat": 23.0, "lon": 113.0},
        {"name": "华北平原", "climate": "temperate", "lat": 37.0, "lon": 116.0},
        {"name": "欧洲中部", "climate": "temperate", "lat": 50.0, "lon": 10.0},
        {"name": "西伯利亚", "climate": "subarctic", "lat": 60.0, "lon": 100.0},
        {"name": "青藏高原", "climate": "alpine", "lat": 32.0, "lon": 90.0},
    ]
    
    # 筛选相同气候类型
    similar = [r for r in reference_regions if r["climate"] == target_climate]
    
    # 按纬度距离排序
    similar.sort(key=lambda r: abs(r["lat"] - target_lat))
    
    return similar[:limit]


# ============================================================
# 距离计算
# ============================================================

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    计算两点间的大圆距离 (km)
    
    Args:
        lat1, lon1: 第一点坐标
        lat2, lon2: 第二点坐标
    
    Returns:
        距离 (公里)
    """
    R = 6371  # 地球平均半径 (km)
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c
