import requests
import re
import json
from datetime import datetime

# 目标 URL
url = "https://www.flightaware.com/live/flight/QTR7P"

# 设置请求头
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

def convert_timestamp(ts):
    """将 Unix 时间戳转换为可读时间格式"""
    if ts:
        return datetime.fromtimestamp(ts).strftime('%Y-%m-%d %H:%M:%S')
    return None

def parse_flight_info(flight):
    """解析单个航班字典中的所有核心字段"""
    return {
        "flight_ident": flight.get("displayIdent", "Unknown"),
        # 机型（多层级回退提取）
        "aircraft_type": flight.get("aircraftTypeFriendly") or flight.get("aircraft", {}).get("friendlyType") or flight.get("aircraft", {}).get("type", "Unknown"),
        # 航司名称
        "airline_name": flight.get("airline", {}).get("fullName") or flight.get("airline", {}).get("shortName", "Unknown"),
        # 速度与距离 (通常嵌套在 flightPlan 字段中)
        "speed": flight.get("filed_speed") or flight.get("flightPlan", {}).get("speed", "Unknown"),
        "distance": flight.get("distance_filed") or flight.get("routeDistance") or flight.get("flightPlan", {}).get("directDistance") or flight.get("flightPlan", {}).get("plannedDistance", "Unknown"),
        # 起降时间（包含预计降落时间，方便追踪空中航班）
        "departure_scheduled": convert_timestamp(flight.get("takeoffTimes", {}).get("scheduled")),
        "departure_actual": convert_timestamp(flight.get("takeoffTimes", {}).get("actual")),
        "arrival_scheduled": convert_timestamp(flight.get("landingTimes", {}).get("scheduled")),
        "arrival_estimated": convert_timestamp(flight.get("landingTimes", {}).get("estimated")),
        "arrival_actual": convert_timestamp(flight.get("landingTimes", {}).get("actual")),
        # 机场缩写 (优先获取 IATA 缩写，如 DOH；如果没有则获取 ICAO 缩写)
        "origin_airport": flight.get("origin", {}).get("iata") or flight.get("origin", {}).get("icao", "Unknown"),
        "destination_airport": flight.get("destination", {}).get("iata") or flight.get("destination", {}).get("icao", "Unknown")
    }

def fetch_flight_data():
    response = requests.get(url, headers=headers)
    
    if response.status_code != 200:
        print(f"请求失败，状态码: {response.status_code}")
        return None

    html_content = response.text
    
    # 定位并提取包含所有航班数据的 trackpollBootstrap 字典
    pattern = re.compile(r'trackpollBootstrap\s*=\s*({.+?});\s*</script>', re.DOTALL)
    match = pattern.search(html_content)
    
    if match:
        json_str = match.group(1)
        try:
            flight_data_raw = json.loads(json_str)
            flights = flight_data_raw.get("flights", {})
            
            if not flights:
                print("解析成功，但未找到 'flights' 数据。")
                return flight_data_raw
                
            flight_ids = list(flights.keys())
            
            # 1. 提取当前最新的航班详情
            current_flight_id = flight_ids[0]
            extracted_data = parse_flight_info(flights[current_flight_id])
            
            # 2. 提取历史航班数据 (Past Flights表格中的全部航班信息)
            history = []
            for fid in flight_ids[1:]:
                history.append(parse_flight_info(flights[fid]))
            
            extracted_data["history"] = history
            return extracted_data

        except json.JSONDecodeError as e:
            print(f"JSON 解析失败: {e}")
            with open("error_log.txt", "w", encoding="utf-8") as f:
                f.write(json_str)
            return None
    else:
        print("未在网页中找到目标数据。")
        return None

# 执行爬虫
data = fetch_flight_data()

# 打印结果进行验证 (格式化输出便于阅读)
if data:
    print(json.dumps(data, indent=4, ensure_ascii=False))


import pymongo

def save_to_mongodb(data):
    # 连接到本地 MongoDB（请根据实际情况修改 URI）
    client = pymongo.MongoClient("mongodb://localhost:27017/")
    db = client["flight_database"]
    collection = db["flight_data"]
    
    # 插入数据，MongoDB 天然支持嵌套字典和列表
    result = collection.insert_one(data)
    print(f"数据成功存入 MongoDB，ID: {result.inserted_id}")

if data:
    save_to_mongodb(data)