# =======================================
# ========== 查询航班实时信息 ============
# =======================================

from flask import Flask, jsonify
from curl_cffi import requests
import re
import json
from datetime import datetime, timedelta
import pymongo
import mysql.connector
import os

app = Flask(__name__)

# 连接 MongoDB
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/") # 本地测试时有个默认后备
client = pymongo.MongoClient(MONGO_URI)
db = client["flight_database"]
collection = db["realtime_flights"]
collection_history = db["flight_history_cache"]

def scrape_flightaware(flight_ident):
    """核心爬虫函数：根据传入的航班号动态抓取"""
    url = f"https://www.flightaware.com/live/flight/{flight_ident}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/114.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    
    print(f"[{flight_ident}] 正在触发实时爬虫...")
    response = requests.get(url, headers=headers, impersonate="chrome110")
    
    if response.status_code != 200:
        return None

    pattern = re.compile(r'trackpollBootstrap\s*=\s*({.+?});\s*</script>', re.DOTALL)
    match = pattern.search(response.text)
    
    if match:
        try:
            raw_data = json.loads(match.group(1))
            flights = raw_data.get("flights", {})
            if not flights:
                return None
            
            # 获取最新的一条记录
            current_flight_id = list(flights.keys())[0]
            flight = flights[current_flight_id]
            
            # 提取你需要的数据 (精简版示例，你可以把之前的解析逻辑全部搬过来)
            # 完善 app.py 中的数据提取字典
            flight_plan = flight.get("flightPlan", {})
            takeoff = flight.get("takeoffTimes", {})
            landing = flight.get("landingTimes", {})
            duration_sec = flight_plan.get("ete")
            # 2. 如果网站的 JSON 中没有提供 ete，通过 起降时间相减 进行兜底计算
            if not duration_sec:
                dep_time = takeoff.get("actual") or takeoff.get("scheduled")
                arr_time = landing.get("actual") or landing.get("estimated") or landing.get("scheduled")
                
                if dep_time and arr_time and arr_time > dep_time:
                    duration_sec = arr_time - dep_time
                else:
                    duration_sec = 28800

            extracted_data = {
                "flight_ident": flight_ident,
                "aircraft_type": flight.get("aircraftTypeFriendly") or flight.get("aircraft", {}).get("friendlyType", "Unknown"),
                "origin_airport": flight.get("origin", {}).get("iata", "Unknown"),
                "destination_airport": flight.get("destination", {}).get("iata", "Unknown"),
                "speed": flight.get("filed_speed") or flight_plan.get("speed", "N/A"),
                "distance": flight.get("distance_filed") or flight_plan.get("directDistance", "N/A"),
                "altitude": flight_plan.get("altitude", "N/A"),
                "departure_actual": takeoff.get("actual", "N/A"),
                "arrival_estimated": landing.get("estimated", "N/A"),
                "duration": duration_sec,
                "last_updated": datetime.now()
            }
            return extracted_data
        except:
            return None
    return None

# ==========================================
# 1. 纯净的“备菜函数” (不含任何 jsonify)
# ==========================================
def fetch_flight_data_with_cache(flight_ident):
    """先查 MongoDB 缓存，没有再爬取，返回纯 Python 字典"""
    existing_data = collection.find_one({"flight_ident": flight_ident})
    
    need_scrape = True
    if existing_data:
        time_diff = datetime.now() - existing_data.get("last_updated", datetime.min)
        if time_diff < timedelta(minutes=60):
            need_scrape = False
            print(f"[{flight_ident}] 命中数据库缓存，直接返回！")

    if need_scrape:
        new_data = scrape_flightaware(flight_ident) # 你的核心爬虫
        if new_data:
            collection.update_one(
                {"flight_ident": flight_ident}, 
                {"$set": new_data}, 
                upsert=True
            )
            existing_data = new_data
        else:
            return None

    if existing_data and "_id" in existing_data:
        existing_data["_id"] = str(existing_data["_id"])
        
    return existing_data  # ✅ 返回纯字典

# ==========================================
# 2. 专属服务员：Flask 路由接口
# ==========================================
@app.route('/api/flight/<flight_ident>', methods=['GET'])
def get_flight_info(flight_ident):
    """给前端浏览器调用的接口，这里才可以使用 jsonify"""
    data = fetch_flight_data_with_cache(flight_ident)
    
    if data:
        return jsonify(data) # ✅ 包装成网络响应
    else:
        return jsonify({"error": "无法抓取该航班数据或遭遇拦截"}), 500

# =======================================
# ========== 查询航班历史数据 ============
# =======================================

from bs4 import BeautifulSoup
# 确保文件顶部已经导入了 bs4: from bs4 import BeautifulSoup

def scrape_flight_history(flight_ident):
    """历史航班爬虫函数"""
    # 动态拼接目标历史页面 URL
    url = f"https://www.flightaware.com/live/flight/{flight_ident}/history"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    
    print(f"[{flight_ident}] 正在触发历史航班爬虫...")
    response = requests.get(url, headers=headers, impersonate="chrome110")
    
    if response.status_code != 200:
        return None

    soup = BeautifulSoup(response.text, 'html.parser')
    table = soup.find('table', class_='prettyTable')
    
    if not table:
        return None

    results = []
    rows = table.find_all('tr')[1:]
    
    for row in rows:
        tds = row.find_all('td')
        if len(tds) < 7:
            continue
            
        try:
            # 提取逻辑与你的 flighthistory.py 保持完全一致
            date_raw = tds[0].get_text(strip=True)
            try:
                date_val = datetime.strptime(date_raw, '%d-%b-%Y').strftime('%Y-%m-%d')
            except ValueError:
                date_val = date_raw

            aircraft = tds[1].get_text(strip=True)

            def extract_iata(td):
                a_tag = td.find('a')
                if a_tag:
                    text = a_tag.get_text(strip=True)
                    return text.split('/')[0].strip() if '/' in text else text
                return "Unknown"
            
            origin = extract_iata(tds[2])
            destination = extract_iata(tds[3])

            def extract_time(td):
                tz_span = td.find('span', class_='tz')
                if tz_span:
                    tz_span.extract()
                time_raw = td.get_text(strip=True)
                try:
                    return datetime.strptime(time_raw, '%I:%M%p').strftime('%H:%M')
                except ValueError:
                    return time_raw

            departure = extract_time(tds[4])
            arrival = extract_time(tds[5])

            duration_raw = tds[6].get_text(strip=True)
            if ":" in duration_raw:
                parts = duration_raw.split(":")
                duration = f"{parts[0]}h {parts[1]}m"
            else:
                duration = duration_raw 

            results.append({
                "Date": date_val,
                "Aircraft": aircraft,
                "Origin": origin,
                "Destination": destination,
                "Departure": departure,
                "Arrival": arrival,
                "Duration": duration
            })
            
            if len(results) >= 10:
                break
                
        except Exception as e:
            continue

    # 将 10 条记录打包成一个字典返回
    return {
        "flight_ident": flight_ident,
        "history_records": results,
        "last_updated": datetime.now()
    }

# --- 新增历史数据 API 路由 ---
collection_history = db["flight_history_cache"] # 使用一个新的集合存放历史记录

@app.route('/api/history/<flight_ident>', methods=['GET'])
def get_flight_history(flight_ident):
    existing_data = collection_history.find_one({"flight_ident": flight_ident})
    
    need_scrape = True
    if existing_data:
        time_diff = datetime.now() - existing_data.get("last_updated", datetime.min)
        # 历史数据变动慢，缓存 12 小时 (720分钟)
        if time_diff < timedelta(minutes=720):
            need_scrape = False
            print(f"[{flight_ident}] 命中历史数据缓存！")

    if need_scrape:
        new_data = scrape_flight_history(flight_ident)
        if new_data and new_data["history_records"]:
            collection_history.update_one(
                {"flight_ident": flight_ident}, 
                {"$set": new_data}, 
                upsert=True
            )
            existing_data = new_data
        else:
            return {"error": "无法抓取历史数据"}, 500

    if existing_data and "_id" in existing_data:
        existing_data["_id"] = str(existing_data["_id"])
        
    return existing_data

if __name__ == '__main__':
    # 启动后台服务器，运行在 5000 端口
    app.run(debug=True, port=5000)