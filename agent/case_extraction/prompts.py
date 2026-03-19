EXTRACT_INFO_FROM_PAPER_PROMPT = """
# 角色
你是一个遥感生态建模专家，精通 PROSAIL 辐射传输模型（PROSPECT + SAIL）的原理、参数体系及其在植被遥感中的应用。

# 任务
请仔细阅读下面的学术论文内容，按以下步骤执行：

## 第一步：相关性判断
判断论文中是否包含 PROSAIL 模型（含 PROSPECT、SAIL、4SAIL、PROSAIL-D、PROSAIL-5B 等变体）的实验案例。
判断依据包括但不限于：
- 论文是否明确提及使用了 PROSAIL 或其子模型进行模拟、反演或验证
- 论文是否涉及 PROSAIL 模型的参数设置与实验结果
- 仅在参考文献或背景介绍中提及 PROSAIL 但未实际使用的，不视为包含实验案例

如果论文中不包含 PROSAIL 相关实验案例，直接输出 None，不要输出任何其他内容。

## 第二步：信息提取（仅在第一步判断为包含时执行）
从论文中提取与 PROSAIL 模型相关的实验案例信息。
请逐步思考，确保提取内容准确、完整，不要编造论文中未提及的信息。

# 提取要求
1. 模型版本与配置：识别论文中使用的 PROSAIL 模型版本（如 PROSAIL-D、PROSAIL-5B 等）及耦合方式
2. 模型参数设置：提取 PROSPECT 叶片光学参数和 SAIL 冠层结构参数的具体取值或取值范围
3. 实验地点：提取研究区域的地理位置，包括国家、省/州、具体站点名称、经纬度等
4. 实验时间：提取数据采集或实验开展的具体时间段
5. 植被对象：提取研究涉及的植被类型、作物种类或生态系统类型
6. 遥感数据源：提取使用的卫星/传感器类型及波段信息
7. 反演/验证方法：提取参数反演策略或模型验证方法

# 输出格式
- 若论文不包含 PROSAIL 实验案例，直接输出：None
- 若包含，严格按照以下 JSON 格式输出，未提及的字段填写 null：
{{
    "model_version": "使用的 PROSAIL 模型版本",
    "prospect_parameters": {{
        "N": {{"description": "叶片结构参数", "value": "取值或范围", "unit": "单位"}},
        "Cab": {{"description": "叶绿素a+b含量", "value": "取值或范围", "unit": "μg/cm²"}},
        "Car": {{"description": "类胡萝卜素含量", "value": "取值或范围", "unit": "μg/cm²"}},
        "Cbrown": {{"description": "褐色色素含量", "value": "取值或范围", "unit": "无量纲"}},
        "Cw": {{"description": "等效水厚度", "value": "取值或范围", "unit": "cm"}},
        "Cm": {{"description": "干物质含量", "value": "取值或范围", "unit": "g/cm²"}},
        "Cant": {{"description": "花青素含量", "value": "取值或范围", "unit": "μg/cm²"}}
    }},
    "sail_parameters": {{
        "LAI": {{"description": "叶面积指数", "value": "取值或范围", "unit": "m²/m²"}},
        "ALA": {{"description": "平均叶倾角", "value": "取值或范围", "unit": "°"}},
        "hotspot": {{"description": "热点参数", "value": "取值或范围", "unit": "无量纲"}},
        "soil_brightness": {{"description": "土壤亮度参数", "value": "取值或范围", "unit": "无量纲"}}
    }},
    "observation_geometry": {{
        "SZA": {{"description": "太阳天顶角", "value": "取值或范围", "unit": "°"}},
        "VZA": {{"description": "观测天顶角", "value": "取值或范围", "unit": "°"}},
        "RAA": {{"description": "相对方位角", "value": "取值或范围", "unit": "°"}}
    }},
    "study_area": {{
        "country": "国家",
        "region": "省/州/地区",
        "site_name": "具体站点名称",
        "coordinates": {{"lat": "纬度", "lon": "经度"}}
    }},
    "experiment_time": {{
        "start_date": "起始日期",
        "end_date": "结束日期"
    }},
    "vegetation": {{
        "type": "植被类型（如农作物、森林、草地、湿地等）",
        "species": "具体物种名称",
        "growth_stage": "生长阶段",
        "growing_season": "生长季节描述"
    }},
    "remote_sensing_data": {{
        "satellite": "卫星名称",
        "sensor": "传感器名称",
        "bands": ["使用的波段列表"],
        "spatial_resolution": "空间分辨率",
        "temporal_resolution": "时间分辨率"
    }},
    "inversion_method": "参数反演或验证方法描述",
    "key_findings": "主要研究发现摘要"
}}

# 约束
1. 必须仅返回 None 或 JSON 数据，禁止输出任何解释性文字或 Markdown 标记
2. 所有参数取值必须忠实于论文原文，不得猜测或编造
3. 若论文包含多个实验案例，将结果组织为 JSON 数组
4. 参数值尽量保留原文中的数值精度

# 论文内容
{paper_context}
"""


EXTRACT_LUE_MODEL_PROMPT = """
# 角色
你是一个遥感生态建模专家，精通各类光能利用率（Light Use Efficiency, LUE）模型的原理、参数体系及其在植被生产力估算中的应用。
你熟悉的 LUE 模型包括但不限于：CASA、GLO-PEM、VPM、EC-LUE、MODIS-PSN（MOD17）、3-PG、BEAMS、C-Fix、CFlux、BEPS、EPIC、TEM、CEVSA 等。

# 任务
请仔细阅读下面的学术论文内容，按以下步骤执行：

## 第一步：相关性判断
判断论文中是否包含光能利用率（LUE）模型的实验案例。
判断依据包括但不限于：
- 论文是否明确使用了某种 LUE 模型进行 GPP/NPP/NEP 估算、模拟或验证
- 论文是否涉及最大光能利用率（LUEmax / εmax / ε*）参数的设定、标定或优化
- 论文是否涉及 LUE 模型中环境胁迫因子（温度、水分、VPD 等）对光能利用率的调控
- 仅在参考文献或背景介绍中提及 LUE 模型但未实际使用的，不视为包含实验案例

如果论文中不包含 LUE 模型相关实验案例，直接输出 None，不要输出任何其他内容。

## 第二步：信息提取（仅在第一步判断为包含时执行）
从论文中提取与 LUE 模型相关的实验案例信息，重点提取最大光能利用率（LUEmax）参数及其相关设置。
请逐步思考，确保提取内容准确、完整，不要编造论文中未提及的信息。

# 提取要求
1. 模型名称与版本：识别论文中使用的 LUE 模型名称（如 CASA、VPM、EC-LUE、MOD17 等）及版本
2. 最大光能利用率参数：提取 LUEmax（εmax）的具体取值，包括：
   - 数值大小与单位（常见单位：gC/MJ、gC·m⁻²·MJ⁻¹、μmol CO₂/μmol photon 等）
   - 该值的来源（文献引用、实测标定、模型优化、遥感反演等）
   - 是否区分不同植被类型设定不同的 LUEmax
3. 环境胁迫因子：提取模型中用于调控实际 LUE 的环境因子及其参数化方案
   - 温度胁迫因子（Tscalar）：最适温度、上下限温度等
   - 水分胁迫因子（Wscalar）：基于土壤含水量、降水、蒸散比等
   - VPD 胁迫因子：饱和水汽压差相关参数
   - 其他胁迫因子（如 CO₂ 浓度、氮限制等）
4. 实验地点：提取研究区域的地理位置，包括国家、省/州、具体站点名称、经纬度等
5. 实验时间：提取数据采集或实验开展的具体时间段
6. 植被对象：提取研究涉及的植被类型、生态系统类型
7. 遥感数据源：提取使用的卫星/传感器类型及相关植被指数（NDVI、EVI、FPAR 等）
8. 验证数据：提取用于验证的通量塔数据或实测数据来源
9. 模型表现：提取模型估算精度指标（R²、RMSE、偏差等）

# 输出格式
- 若论文不包含 LUE 模型实验案例，直接输出：None
- 若包含，严格按照以下 JSON 格式输出，未提及的字段填写 null：
{{
    "model_name": "LUE模型名称（如CASA、VPM、EC-LUE等）",
    "model_version": "模型版本或变体说明",
    "lue_max": {{
        "value": "最大光能利用率数值",
        "unit": "单位（如gC/MJ、gC·m⁻²·MJ⁻¹等）",
        "source": "参数来源（如文献引用、实测标定、模型优化等）",
        "by_vegetation_type": {{
            "植被类型1": {{"value": "对应LUEmax值", "unit": "单位"}},
            "植被类型2": {{"value": "对应LUEmax值", "unit": "单位"}}
        }}
    }},
    "stress_factors": {{
        "temperature": {{
            "description": "温度胁迫因子参数化方案",
            "T_opt": {{"value": "最适温度", "unit": "°C"}},
            "T_min": {{"value": "最低温度阈值", "unit": "°C"}},
            "T_max": {{"value": "最高温度阈值", "unit": "°C"}}
        }},
        "water": {{
            "description": "水分胁迫因子参数化方案",
            "method": "水分胁迫计算方法（如基于土壤含水量、降水指数、蒸散比等）",
            "parameters": "相关参数取值"
        }},
        "vpd": {{
            "description": "VPD胁迫因子参数化方案",
            "parameters": "相关参数取值"
        }},
        "other": {{
            "description": "其他胁迫因子说明",
            "parameters": "相关参数取值"
        }}
    }},
    "productivity_type": "估算的生产力类型（GPP/NPP/NEP）",
    "vegetation_index": {{
        "type": "使用的植被指数（NDVI/EVI/FPAR等）",
        "source": "植被指数数据来源",
        "temporal_resolution": "时间分辨率"
    }},
    "study_area": {{
        "country": "国家",
        "region": "省/州/地区",
        "site_name": "具体站点名称",
        "coordinates": {{"lat": "纬度", "lon": "经度"}},
        "spatial_scale": "研究空间尺度（站点/区域/全球）"
    }},
    "experiment_time": {{
        "start_date": "起始日期",
        "end_date": "结束日期"
    }},
    "vegetation": {{
        "type": "植被类型（如常绿针叶林、落叶阔叶林、农田、草地等）",
        "species": "具体物种名称",
        "biome": "生物群落分类（如IGBP分类）"
    }},
    "remote_sensing_data": {{
        "satellite": "卫星名称",
        "sensor": "传感器名称",
        "products": ["使用的遥感产品列表（如MOD13A2、MOD15A2等）"],
        "spatial_resolution": "空间分辨率",
        "temporal_resolution": "时间分辨率"
    }},
    "validation": {{
        "flux_tower": "通量塔站点名称或网络（如AmeriFlux、ChinaFLUX等）",
        "metrics": {{
            "R2": "决定系数",
            "RMSE": "均方根误差",
            "bias": "偏差",
            "other": "其他精度指标"
        }}
    }},
    "key_findings": "主要研究发现摘要"
}}

# 约束
1. 必须仅返回 None 或 JSON 数据，禁止输出任何解释性文字或 Markdown 标记
2. 所有参数取值必须忠实于论文原文，不得猜测或编造
3. 若论文包含多个实验案例或多个LUE模型对比，将结果组织为 JSON 数组
4. 参数值尽量保留原文中的数值精度
5. LUEmax 的单位务必准确提取，不同单位之间不要自行换算
6. 若论文针对不同植被类型使用了不同的 LUEmax 值，必须逐一列出

# 论文内容
{paper_context}
"""
