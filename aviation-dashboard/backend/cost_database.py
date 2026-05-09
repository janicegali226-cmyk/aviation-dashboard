import pandas as pd
import mysql.connector
from datetime import datetime
import random
import time
from apscheduler.schedulers.blocking import BlockingScheduler
import re
from app import fetch_flight_data_with_cache # 从你的 app.py 文件中导入爬虫函数
import math
import os

# ==========================================
# 1. 数据库配置与物理距离
# ==========================================
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", 4000)),  # 明确指向 TiDB 的 4000 端口
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
    "ssl_verify_cert": True,                  # 开启 SSL 证书验证
    "ssl_verify_identity": True               # 开启 SSL 身份验证 (TiDB 必须要求)
}

# 计算8条航线的物理距离
# 建立机场的精确经纬度坐标库 (纬度 Latitude, 经度 Longitude)
AIRPORT_COORDS = {
    'SIN': (1.3644, 103.9915),   # 新加坡樟宜
    'DXB': (25.2532, 55.3657),   # 迪拜
    'LHR': (51.4700, -0.4543),   # 伦敦希思罗
    'BKK': (13.6900, 100.7501),  # 曼谷素万那普
    'HKG': (22.3080, 113.9185),  # 香港赤鱲角
    'DOH': (25.2731, 51.6080),   # 多哈哈马德
    'BOM': (19.0896, 72.8656),   # 孟买
    'MEL': (-37.6690, 144.8410)  # 墨尔本
}

def calculate_great_circle_distance(route):
    """
    使用 Haversine 公式计算两个机场之间的大圆距离（即最科学的物理直线距离）
    输入: 航线代码 (如 'SIN-DXB')
    输出: 距离 (单位: 公里 km)
    """
    try:
        # 将 'SIN-DXB' 拆分为起降机场
        origin, dest = route.split('-')
        lat1, lon1 = AIRPORT_COORDS[origin]
        lat2, lon2 = AIRPORT_COORDS[dest]

        # 地球平均半径 (公里)
        R = 6371.0

        # 将经度、纬度从度数转换为弧度
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)

        # Haversine 核心计算
        dlon = lon2_rad - lon1_rad
        dlat = lat2_rad - lat1_rad
        
        a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
        c = 2 * math.asin(math.sqrt(a))
        
        distance = R * c
        return round(distance, 2)
    
    except KeyError as e:
        print(f"⚠️ 坐标库中缺少机场: {e}")
        return None
    except Exception as e:
        print(f"⚠️ 距离计算失败 {route}: {e}")
        return None

# ==========================================
# 2. 数据获取与爬虫接口
# ==========================================
def get_oil_prices(cursor):
    """提取最新油价与战前2月份均值基准"""
    try:
        cursor.execute("""
            SELECT jet_fuel_price FROM oil_price_history 
            WHERE jet_fuel_price IS NOT NULL ORDER BY record_date DESC LIMIT 1
        """)
        latest = cursor.fetchone()
        current_price = float(latest['jet_fuel_price']) if latest and latest.get('jet_fuel_price') is not None else 159.36
        
        cursor.execute("""
            SELECT AVG(jet_fuel_price) AS avg_price FROM oil_price_history 
            WHERE jet_fuel_price IS NOT NULL 
            AND record_date >= '2026-02-01' AND record_date < '2026-03-01'
        """)
        baseline = cursor.fetchone()
        baseline_price = float(baseline['avg_price']) if baseline and baseline.get('avg_price') is not None else 115.40
        
        return current_price, baseline_price
    except Exception as e:
        print(f"提取油价失败: {e}")
        return 159.36, 115.40

def fetch_realtime_flight_data(ident, route, baseline_air_time):
    """
    调用 app.py 中的 Selenium 爬虫获取真实的实际飞行时间
    """
    actual_air_time = baseline_air_time # 默认兜底：如果爬虫失败，就用完美基准时间代替
    
    print(f"  🕷️ 启动爬虫，正在抓取航班 {ident} ...")
    try:
        # 调用你的爬虫函数
        scraped_data = fetch_flight_data_with_cache(ident)
        
        if scraped_data and scraped_data.get('duration'):
            duration_seconds = scraped_data['duration']
            
            # 直接将秒数转换为小时 (例如 28800秒 / 3600 = 8.0小时)
            if isinstance(duration_seconds, (int, float)) and duration_seconds > 0:
                actual_air_time = duration_seconds / 3600.0
                print(f"  ✅ 成功抓取 {ident} 实际空中时间: {actual_air_time:.2f}h")
            else:
                print(f"  ⚠️ {ident} 时间无效, 使用基准时间。")
        else:
            print(f"  ⚠️ {ident} 查无数据或网页结构改变, 使用基准时间。")
            
    except Exception as e:
        print(f"  ❌ 爬虫执行过程中发生错误: {e}")
    
    # ⚠️ 爬虫防封禁保护：每次 Selenium 抓取完毕后随机暂停 3 到 6 秒
    # 防止 FlightAware 的 Cloudflare 防火墙察觉到是机器人批量请求
    time.sleep(random.uniform(3, 6))

    # ---------------- 附加数据模拟 ----------------
    
    # 1. 战争险逻辑：只要涉及中东高风险枢纽，就征收附加费
    if 'DXB' in route or 'DOH' in route:
        war_risk = 5000
    else:
        war_risk = 0

    # 2. 额外经停费逻辑：定义长距离航线“白名单”
    long_haul_routes = ['SIN-LHR', 'MEL-DXB', 'LHR-DXB', 'DOH-SIN']
    
    # 如果当前航线在这个长航线列表里，则有 50% 的概率产生 1000 的经停费
    if route in long_haul_routes:
        extra_stop = random.choices([0, 1000], weights=[70, 30])[0]
    else:
        extra_stop = 0
        
    return actual_air_time, 0, war_risk, extra_stop

# ==========================================
# 3. 核心核算引擎 (完全基于新CSV驱动)
# ==========================================
def calculate_matrix_data():
    print(f"[{datetime.now()}] 🟢 开始执行严格成本核算逻辑 (基于直飞 CSV 数据)...")
    
    db = mysql.connector.connect(**DB_CONFIG)
    cursor = db.cursor(dictionary=True)

    
    # == 获取油价数据 ==
    current_oil_price, baseline_oil_price = get_oil_prices(cursor)
    print(f"📊 战前基准燃油价格: ${baseline_oil_price:.2f}/bbl | 当前价格: ${current_oil_price:.2f}/bbl")

    # ----- 核心改动：直接读取新的 CSV 文件 -----
    try:
        # 注意替换为你实际的 CSV 文件名
        df = pd.read_csv('routes1.csv')
        # 清理列名两端的空格（CSV中可能会带有隐形空格）
        df.columns = df.columns.str.strip()
        
        # 去重：确保每条航线-航司组合只计算一次（保留第一条航班号）
        # 基于航班号去重，确保 31 个不同的航班都能被保留并交给爬虫去抓
        unique_flights = df.drop_duplicates(subset=['ident'])
    except Exception as e:
        print(f"读取 CSV 数据源失败: {e}")
        return
    
    # 重建表结构：新增 5 个成本拆分字段
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cost_matrix_data (
            airline VARCHAR(100),
            route VARCHAR(50),
            ident VARCHAR(20),
            aircraft VARCHAR(100),
            fluctuation_pct FLOAT,
            extra_fuel FLOAT,
            extra_crew FLOAT,
            baseline_air_time FLOAT,
            baseline_fuel_cost FLOAT,
            baseline_crew_cost FLOAT,
            actual_air_time FLOAT,
            current_fuel_cost FLOAT,
            current_crew_cost FLOAT,
            war_risk FLOAT,
            extra_stop FLOAT,
            delay_comp FLOAT,
            update_time DATETIME,
            PRIMARY KEY (airline, route, ident)
        )
    """)

    matrix_records = []
    taxi_time_constant = 0.6 
    crew_hourly_wage = 180.0 

    # 遍历 CSV 中的每一行直飞数据
    for index, row in unique_flights.iterrows():
        route = row['route']
        airline = row['airline']
        ident = row['ident']
        aircraft_model = row['aircraft_model']
        
        # 每次动态计算最科学的地球大圆物理距离
        distance_in_theory = calculate_great_circle_distance(route)
        distance = distance_in_theory * 1.06 # 实际距离=理论距离*（1+常规航路损耗系数（5%-8%））
        
        if not distance:
            print(f"跳过 {route}: 无法计算距离")
            continue # 如果坐标缺失导致无法计算，跳过这行
            
        speed = float(row['cruise_speed_kmh'])
        fuel_burn_gal = float(row['fuel_burn_gal_per_hr'])
        fuel_burn_bbl = fuel_burn_gal / 42.0 
        crew_size = float(row['standard_crew_size'])
        max_pax = float(row['max_pax_capacity'])

        # --- A. 计算战前成本 ---
        baseline_air_time = distance / speed if speed > 0 else 0
        baseline_block_time = baseline_air_time + taxi_time_constant
        
        baseline_fuel_cost = baseline_air_time * fuel_burn_bbl * baseline_oil_price
        baseline_crew_cost = baseline_block_time * crew_size * crew_hourly_wage
        baseline_cost = baseline_fuel_cost + baseline_crew_cost
        
        # --- B. 计算当前成本 ---
        actual_air_time, delay_mins, war_risk, extra_stop = fetch_realtime_flight_data(ident, route, baseline_air_time)
        actual_block_time = actual_air_time + taxi_time_constant
        
        delay_comp = 0
        if delay_mins >= 180:
            delay_comp = 250 * max_pax
        elif 90 <= delay_mins < 180:
            delay_comp = 150 * max_pax
            
        # 燃油成本 & 机组薪酬
        current_fuel_cost = actual_air_time * fuel_burn_bbl * current_oil_price
        current_crew_cost = actual_block_time * crew_size * crew_hourly_wage

        # 额外燃油成本 & 额外机组薪酬
        extra_fuel = round(current_fuel_cost - baseline_fuel_cost, 2)
        extra_crew = round(current_crew_cost - baseline_crew_cost, 2)

        current_cost = current_fuel_cost + current_crew_cost + delay_comp + war_risk + extra_stop # 当前总成本

        # --- C. 计算涨幅百分比 ---
        fluctuation_pct = 0.0
        if baseline_cost > 0:
            fluctuation_pct = ((current_cost - baseline_cost) / baseline_cost) * 100
        
        matrix_records.append((
            airline,
            route,
            ident,
            aircraft_model,
            round(fluctuation_pct, 1),
            extra_fuel,
            extra_crew,
            float(war_risk),
            float(extra_stop),
            float(delay_comp),
            round(baseline_air_time, 2),
            round(baseline_fuel_cost, 2),
            round(baseline_crew_cost, 2),
            round(actual_air_time, 2),
            round(current_fuel_cost, 2),
            round(current_crew_cost, 2),
            datetime.now()
        ))

    try:
        cursor.execute("TRUNCATE TABLE cost_matrix_data")
        sql = """
            REPLACE INTO cost_matrix_data 
            (airline, route, ident, aircraft, fluctuation_pct, 
             extra_fuel, extra_crew, war_risk, extra_stop, delay_comp,
             baseline_air_time, baseline_fuel_cost, baseline_crew_cost,
             actual_air_time, current_fuel_cost, current_crew_cost,
             update_time) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """
        cursor.executemany(sql, matrix_records)
        db.commit()
        print(f"✅ 成功依据 CSV 映射更新了 {len(matrix_records)} 条直飞航线成本数据！")
    except Exception as e:
        print(f"❌ 数据入库失败: {e}")
    finally:
        cursor.close()
        db.close()