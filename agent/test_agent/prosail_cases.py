"""
PROSAIL 参数化案例服务

从 prosail_parameters.csv 读取案例数据，支持按省份筛选
"""

import csv
import re
from typing import List, Dict, Optional, Any

from .repository_registry import get_cases_csv_path, normalize_model_id


def _csv_path(kg_id: str = "prosail"):
    return get_cases_csv_path(kg_id)


def _parse_range(value: str) -> tuple:
    """
    解析参数范围字符串，返回 (min, max)
    
    支持格式:
    - "0.5~8" -> (0.5, 8.0)
    - "[0, 5]" -> (0.0, 5.0)
    - "0~3.0" -> (0.0, 3.0)
    - "1~10,1~100" -> (1.0, 100.0)  # 取整体范围
    - 单个值 "1.5" -> (1.5, 1.5)
    """
    if not value or value.strip() in ['', '-', '—', '无', '未知', 'N/A']:
        return (None, None)
    
    value = value.strip()
    
    # 处理多个范围的情况，取整体范围
    all_nums = re.findall(r'[\d.]+', value)
    if all_nums:
        nums = [float(n) for n in all_nums if n]
        if nums:
            return (min(nums), max(nums))
    
    return (None, None)


def _extract_paper_title(title: str) -> str:
    """提取论文标题（清理格式）"""
    if not title:
        return "未知来源"
    # 移除多余空格和特殊字符
    return title.strip().replace('\n', ' ').replace('  ', ' ')[:100]


def _normalize_case_id(case_id: str) -> str:
    """
    兼容多种 case_id 形式，统一提取为标准 `case_<n>`：
    - case_12
    - 衡水_case_12
    - 任意包含 case_12 的字符串
    """
    raw = (case_id or "").strip()
    if not raw:
        return raw
    matched = re.search(r"(case_\d+)", raw, re.IGNORECASE)
    if matched:
        return matched.group(1).lower()
    return raw


def load_prosail_cases(kg_id: str = "prosail") -> List[Dict[str, Any]]:
    """
    加载所有 PROSAIL 参数化案例
    
    Returns:
        案例列表，每个案例包含完整信息
    """
    cases = []
    
    csv_file_path = _csv_path(kg_id)
    model_id = normalize_model_id(kg_id) or "prosail"

    if not csv_file_path.exists():
        print(f"[PROSAIL_CASES] CSV 文件不存在 ({model_id}): {csv_file_path}")
        return cases
    
    try:
        with open(csv_file_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            
            for idx, row in enumerate(reader):
                # 解析坐标
                lat = None
                lng = None
                try:
                    if row.get('纬度'):
                        lat = float(row['纬度'])
                    if row.get('经度'):
                        lng = float(row['经度'])
                except (ValueError, TypeError):
                    pass
                
                # 解析参数
                parameters = []
                
                # 叶片参数
                param_mappings = [
                    ('叶面积指数LAI', 'LAI', '叶片参数', ''),
                    ('叶绿素Cab(μg/cm²)', 'Cab', '叶片参数', 'μg/cm²'),
                    ('叶片叶绿素LCC', 'LCC', '叶片参数', ''),
                    ('类胡萝卜素Car(μg/cm²)', 'Car', '叶片参数', 'μg/cm²'),
                    ('棕色素Cbrown', 'Cbrown', '叶片参数', ''),
                    ('等效水厚度Cw', 'Cw', '叶片参数', 'g/cm²'),
                    ('干物质含量Cm(g/cm²)', 'Cm', '叶片参数', 'g/cm²'),
                    ('叶片结构参数N', 'N', '叶片参数', ''),
                    ('叶倾角分布LAD(°)', 'LAD', '冠层参数', '°'),
                    ('热点参数Hot', 'Hot', '冠层参数', ''),
                    ('土壤参数ρsoil', 'rsoil', '土壤参数', ''),
                    ('太阳天顶角SZA(°)', 'SZA', '观测几何', '°'),
                    ('观测天顶角OZA(°)', 'OZA', '观测几何', '°'),
                    ('相对方位角RAA(°)', 'RAA', '观测几何', '°'),
                ]
                
                for csv_col, param_code, category, unit in param_mappings:
                    value = row.get(csv_col, '')
                    min_val, max_val = _parse_range(value)
                    if min_val is not None or max_val is not None:
                        parameters.append({
                            'name': param_code,
                            'category': category,
                            'min': min_val,
                            'max': max_val,
                            'unit': unit,
                            'raw_value': value,
                        })
                
                # 构建案例对象
                case = {
                    'id': f"case_{idx + 1}",
                    'kg_id': model_id,
                    'paper_title': _extract_paper_title(row.get('论文标题', '')),
                    'province': row.get('省份', ''),
                    'place_name': row.get('地名', ''),
                    'lat': lat,
                    'lng': lng,
                    'experiment_time': row.get('实验时间', ''),
                    'vegetation_type': row.get('植被类型', ''),
                    'note': row.get('备注', ''),
                    'parameters': parameters,
                }
                
                cases.append(case)
                
    except Exception as e:
        print(f"[PROSAIL_CASES] 加载 CSV 失败 ({model_id}): {e}")
        import traceback
        traceback.print_exc()

    print(f"[PROSAIL_CASES] 加载了 {len(cases)} 个案例 ({model_id})")
    return cases


def get_cases_by_province(province: str, kg_id: str = "prosail") -> List[Dict[str, Any]]:
    """
    按省份筛选案例
    
    Args:
        province: 省份名称（如 "湖北省"、"湖北"）
        
    Returns:
        该省份的案例列表
    """
    all_cases = load_prosail_cases(kg_id=kg_id)
    
    # 标准化省份名称
    normalized_province = province.replace('省', '').replace('市', '').replace('自治区', '')
    
    matched_cases = []
    for case in all_cases:
        case_province = case.get('province', '')
        normalized_case_province = case_province.replace('省', '').replace('市', '').replace('自治区', '')
        
        if normalized_province in normalized_case_province or normalized_case_province in normalized_province:
            matched_cases.append(case)
    
    print(f"[PROSAIL_CASES] 省份 '{province}' 匹配到 {len(matched_cases)} 个案例 ({normalize_model_id(kg_id)})")
    return matched_cases


def convert_case_to_geo_point(case: Dict[str, Any], target_lat: float = None, target_lng: float = None, include_full_details: bool = False) -> Dict[str, Any]:
    """
    将案例转换为 GeoPoint 格式（用于前端地图展示）
    
    Args:
        case: 案例数据
        target_lat: 目标点纬度（用于计算相似度）
        target_lng: 目标点经度
        include_full_details: 是否包含完整详情（默认False，用于精简状态）
        
    Returns:
        GeoPoint 格式的字典
    """
    # 计算距离相似度（如果有目标点）
    similarity = 0.7  # 默认相似度
    match_reason = f"同省案例 - {case.get('vegetation_type', '植被')}"
    
    if (
        target_lat is not None
        and target_lng is not None
        and case.get('lat') is not None
        and case.get('lng') is not None
    ):
        import math
        # 简单的欧几里得距离（不精确但足够用于展示）
        lat_diff = abs(case['lat'] - target_lat)
        lng_diff = abs(case['lng'] - target_lng)
        distance = math.sqrt(lat_diff ** 2 + lng_diff ** 2)
        
        # 距离越近，相似度越高
        if distance < 0.5:
            similarity = 0.95
            match_reason = "完全匹配区域"
        elif distance < 1:
            similarity = 0.85
            match_reason = "相邻区域案例"
        elif distance < 2:
            similarity = 0.75
            match_reason = "同城市案例"
        else:
            similarity = max(0.5, 0.8 - distance * 0.05)
            match_reason = f"同省案例 - {case.get('vegetation_type', '植被')}"
    
    # 生成友好的案例ID（使用行号和地点）
    place_short = case.get('place_name', '').split('市')[-1].split('县')[-1][:10] or case.get('province', '')[:4]
    case_id = f"{place_short}_{case['id']}"
    
    # 获取完整论文标题
    paper_title = case.get('paper_title', '未知来源')
    
    # 精简版 GeoPoint（用于状态同步，减少 payload）
    geo_point = {
        'id': case['id'],
        'kg_id': case.get('kg_id', 'prosail'),
        'name': case.get('place_name', case.get('province', '未知地点')),
        'lat': case['lat'],
        'lng': case['lng'],
        'point_type': 'reference_case',
        'param_type': 'reference_case',
        'similarity': similarity,
        'match_reason': match_reason,
        # 精简版只包含基本信息，用于地图标记显示
        'paper_title': paper_title[:50] + ('...' if len(paper_title) > 50 else ''),  # 截断标题
        'vegetation_type': case.get('vegetation_type', ''),
    }
    
    # 如果需要完整详情（用于 API 返回）
    if include_full_details:
        pdf_filename = paper_title + '.pdf'
        geo_point['case_details'] = {
            'case_id': case_id,
            'paper_title': paper_title,
            'pdf_filename': pdf_filename,
            'description': case.get('note', '') or f"{case.get('experiment_time', '')} {case.get('vegetation_type', '')} 实验",
            'source_file': pdf_filename,
            'reliability': 'HIGH' if case.get('parameters') and len(case.get('parameters', [])) > 3 else 'MEDIUM',
            'sensor_type': '多光谱/高光谱',
            'region_name': case.get('place_name', ''),
            'region_description': f"{case.get('province', '')} - {case.get('vegetation_type', '')} 实验研究",
        }
        geo_point['parameters'] = case.get('parameters', [])
    
    return geo_point


def get_case_full_details(case_id: str, kg_id: str = "prosail") -> Optional[Dict[str, Any]]:
    """
    根据案例 ID 获取完整详情
    
    Args:
        case_id: 案例 ID
        
    Returns:
        完整的案例详情，如果未找到返回 None
    """
    all_cases = load_prosail_cases(kg_id=kg_id)
    normalized = _normalize_case_id(case_id)

    for case in all_cases:
        if _normalize_case_id(case['id']) == normalized:
            return convert_case_to_geo_point(case, include_full_details=True)
    
    return None


def get_province_cases_as_geo_points(
    province: str, 
    target_lat: float = None, 
    target_lng: float = None,
    kg_id: str = "prosail",
) -> List[Dict[str, Any]]:
    """
    获取指定省份的案例，转换为 GeoPoint 格式
    
    Args:
        province: 省份名称
        target_lat: 目标点纬度
        target_lng: 目标点经度
        
    Returns:
        GeoPoint 列表
    """
    cases = get_cases_by_province(province, kg_id=kg_id)
    geo_points = []
    
    for case in cases:
        if case.get('lat') is None or case.get('lng') is None:
            continue
        geo_point = convert_case_to_geo_point(case, target_lat, target_lng)
        geo_points.append(geo_point)
    
    # 按相似度排序
    geo_points.sort(key=lambda x: x.get('similarity', 0), reverse=True)
    
    return geo_points


def get_all_cases_as_geo_points(kg_id: str = "prosail") -> List[Dict[str, Any]]:
    """
    获取所有有效坐标的案例，转换为 GeoPoint 格式
    用于全局案例库地图展示
    
    Returns:
        GeoPoint 列表（只包含有经纬度信息的案例）
    """
    all_cases = load_prosail_cases(kg_id=kg_id)
    geo_points = []
    for case in all_cases:
        if case.get('lat') is None or case.get('lng') is None:
            continue
        geo_point = convert_case_to_geo_point(case)
        geo_points.append(geo_point)
    print(f"[PROSAIL_CASES] 全局案例 GeoPoints: {len(geo_points)} 个 ({normalize_model_id(kg_id)})")
    return geo_points


def get_cases_as_markdown(kg_id: str = "prosail") -> str:
    """
    将 prosail_parameters.csv 读取并返回 Markdown 格式表格
    只保留核心展示字段，避免内容过长
    """
    csv_file_path = _csv_path(kg_id)
    if not csv_file_path.exists():
        return f"⚠️ 案例库文件不存在，请检查 {csv_file_path}"

    # 要展示的列（名称 → 显示标题）
    DISPLAY_COLUMNS = [
        ("省份",          "省份"),
        ("地名",          "地点"),
        ("实验时间",      "时间"),
        ("植被类型",      "植被类型"),
        ("叶面积指数LAI", "LAI"),
        ("叶绿素Cab(μg/cm²)", "Cab(μg/cm²)"),
        ("等效水厚度Cw",  "Cw"),
        ("干物质含量Cm(g/cm²)", "Cm(g/cm²)"),
        ("叶片结构参数N", "N"),
        ("论文标题",      "来源论文"),
    ]

    try:
        with open(csv_file_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
    except Exception as e:
        return f"⚠️ 读取案例库失败: {e}"

    if not rows:
        return "案例库当前为空。"

    # 构建表头
    headers = [title for _, title in DISPLAY_COLUMNS]
    header_line = "| " + " | ".join(headers) + " |"
    separator   = "| " + " | ".join(["---"] * len(headers)) + " |"

    # 构建数据行
    data_lines = []
    for row in rows:
        cells = []
        for col_key, _ in DISPLAY_COLUMNS:
            val = (row.get(col_key) or "").strip()
            # 截断论文标题
            if col_key == "论文标题" and len(val) > 30:
                val = val[:30] + "…"
            # 替换竖线，避免破坏表格
            val = val.replace("|", "/")
            cells.append(val)
        data_lines.append("| " + " | ".join(cells) + " |")

    total = len(rows)
    summary = f"共收录 **{total}** 条 {normalize_model_id(kg_id).upper()} 建模案例（来源: `{csv_file_path}`）"
    table = "\n".join([header_line, separator] + data_lines)
    return summary + "\n\n" + table


