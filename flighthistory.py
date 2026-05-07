from curl_cffi import requests
from bs4 import BeautifulSoup
from datetime import datetime
import pymongo
import json

# 目标历史页面 URL
url = "https://www.flightaware.com/live/flight/QTR7P/history"

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
}

def fetch_history_with_bs4():
    print(f"正在请求页面: {url} ...")
    # 继续使用 curl_cffi 以防触发真实的 Cloudflare 拦截
    response = requests.get(url, headers=headers, impersonate="chrome110")
    
    if response.status_code != 200:
        print(f"请求失败，状态码: {response.status_code}")
        return

    # 使用 BeautifulSoup 解析 HTML 页面
    soup = BeautifulSoup(response.text, 'html.parser')
    
    # 定位包含历史数据的目标表格 (class="prettyTable")
    table = soup.find('table', class_='prettyTable')
    
    if not table:
        print("未找到航班历史数据表格，网页结构可能变动或遭遇严重拦截。")
        return

    results = []
    
    # 提取表格中的所有行 (跳过第一行表头 [1:])
    rows = table.find_all('tr')[1:]
    
    for row in rows:
        tds = row.find_all('td')
        # 确保这是一行完整的数据（至少有7列）
        if len(tds) < 7:
            continue
            
        try:
            # 1. Date: 例如 "16-Apr-2026" 转换为 "2026-04-16"
            date_raw = tds[0].get_text(strip=True)
            try:
                date_val = datetime.strptime(date_raw, '%d-%b-%Y').strftime('%Y-%m-%d')
            except ValueError:
                date_val = date_raw

            # 2. Aircraft: 例如 "A35K"
            aircraft = tds[1].get_text(strip=True)

            # 3 & 4. Origin & Destination
            # 机场列的文本类似 "Hamad Int'l (DOH / OTHH)"，提取出 <a> 标签里的 "DOH / OTHH" 并截取前半部分
            def extract_iata(td):
                a_tag = td.find('a')
                if a_tag:
                    text = a_tag.get_text(strip=True)
                    return text.split('/')[0].strip() if '/' in text else text
                return "Unknown"
            
            origin = extract_iata(tds[2])
            destination = extract_iata(tds[3])

            # 5 & 6. Departure & Arrival
            # 文本类似 "08:12AM +03"，我们需要把里面的时区 span 标签去掉，只保留纯时间
            def extract_time(td):
                # 移除包含时区信息的 <span class="tz">
                tz_span = td.find('span', class_='tz')
                if tz_span:
                    tz_span.extract()
                time_raw = td.get_text(strip=True)
                # 尝试将 "08:12AM" 转为 24小时制的 "08:12"
                try:
                    return datetime.strptime(time_raw, '%I:%M%p').strftime('%H:%M')
                except ValueError:
                    return time_raw

            departure = extract_time(tds[4])
            arrival = extract_time(tds[5])

            # 7. Duration: 例如 "7:36" 转换为 "7h 36m"
            duration_raw = tds[6].get_text(strip=True)
            if ":" in duration_raw:
                parts = duration_raw.split(":")
                duration = f"{parts[0]}h {parts[1]}m"
            else:
                duration = duration_raw  # 比如显示 "En Route" (在途中)

            # 组合单条数据
            results.append({
                "Date": date_val,
                "Aircraft": aircraft,
                "Origin": origin,
                "Destination": destination,
                "Departure": departure,
                "Arrival": arrival,
                "Duration": duration
            })
            
            # 只抓取最近 10 条
            if len(results) >= 10:
                break
                
        except Exception as e:
            print(f"解析某行数据时出错跳过: {e}")
            continue

    # 存入 MongoDB
    if results:
        client = pymongo.MongoClient("mongodb://localhost:27017/")
        db = client["flight_database"]
        collection = db["flight_history_simple"]
        
        collection.insert_many(results)
        print(f"成功使用 BeautifulSoup 抓取并存入 {len(results)} 条历史数据！")
        
        print("\n抓取字段预览：")
        print(json.dumps(results[0], indent=4, ensure_ascii=False, default=str))
    else:
        print("未提取到任何有效数据。")

if __name__ == "__main__":
    fetch_history_with_bs4()