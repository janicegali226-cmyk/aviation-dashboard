import time
import re
import json
import random
import pandas as pd
from bs4 import BeautifulSoup
import undetected_chromedriver as uc

def scrape_flightaware_exact():
    routes = [
        ('SIN', 'DXB'), ('LHR', 'DXB'), ('BKK', 'DXB'), ('HKG', 'DXB'),
        ('DOH', 'SIN'), ('SIN', 'LHR'), ('BOM', 'DXB'), ('MEL', 'DXB')
    ]
    
    # 8 个核心航司
    target_airlines = [
        "Emirates", "Qatar Airways", "Singapore Airlines", "Cathay Pacific", 
        "British Airways", "Lufthansa", "Air India", "Thai Airways"
    ]
    
    airline_mapping = {
        "emirates": "Emirates", "阿联酋航空": "Emirates",
        "qatar airways": "Qatar Airways", "卡塔尔航空": "Qatar Airways",
        "singapore airlines": "Singapore Airlines", "新加坡航空": "Singapore Airlines", "singapore air": "Singapore Airlines",
        "cathay pacific": "Cathay Pacific", "国泰航空": "Cathay Pacific",
        "british airways": "British Airways", "英国航空": "British Airways",
        "lufthansa": "Lufthansa", "汉莎航空": "Lufthansa",
        "air india": "Air India", "印度航空": "Air India",
        "thai airways": "Thai Airways", "泰国国际航空": "Thai Airways", "泰航": "Thai Airways"
    }
    
    options = uc.ChromeOptions()
    options.add_argument('--lang=en-US')
    options.add_experimental_option('prefs', {'intl.accept_languages': 'en-US,en'})
    
    try:
        # 请根据你的 Chrome 版本确认 version_main
        driver = uc.Chrome(options=options, version_main=139)
    except Exception as e:
        print(f"浏览器启动失败: {e}")
        return pd.DataFrame()

    driver.maximize_window()
    final_data = []

    for origin, dest in routes:
        list_url = f"https://www.flightaware.com/live/findflight?origin={origin}&destination={dest}"
        print(f"\n======================================")
        print(f"[{origin}-{dest}] 正在进入搜索结果页...")
        
        driver.get(list_url)
        time.sleep(random.uniform(6, 9)) 
        
        page_source = driver.page_source
        soup = BeautifulSoup(page_source, 'html.parser')
        
        flight_links = []
        
        # --- 步骤 1: 提取列表，并抓取 Ident ---
        rows = soup.find_all('tr')
        for row in rows:
            row_text = row.get_text(separator=' ', strip=True).lower()
            
            matched_airline = None
            for key, english_name in airline_mapping.items():
                if key in row_text:
                    matched_airline = english_name
                    break
            
            if matched_airline:
                links = row.find_all('a', href=True)
                for a in links:
                    href = a['href']
                    # 匹配详情页链接
                    if '/live/flight/' in href and 'history' not in href and '?' not in href:
                        ident = a.get_text(strip=True) # 提取链接文本作为 Ident
                        full_url = "https://www.flightaware.com" + href if href.startswith('/') else href
                        flight_links.append({
                            "airline": matched_airline, 
                            "ident": ident,
                            "url": full_url
                        })
                        break 
                
        # 去重
        unique_links = {link['url']: link for link in flight_links}.values()
        print(f"[{origin}-{dest}] 捕捉到 {len(unique_links)} 个目标航班，开始校验直达并提取详情...")

        for flight in unique_links:
            print(f" -> 正在查询: {flight['ident']} ({flight['airline']}) ...")
            
            driver.get(flight['url'])
            time.sleep(random.uniform(4, 7))
            
            detail_source = driver.page_source
            detail_soup = BeautifulSoup(detail_source, 'html.parser')
            
            aircraft_model = "Unknown"
            cruise_speed_kmh = "Unknown"
            is_direct_flight = True 
            
            # --- 步骤 2: 详情页数据提取与直达校验 ---
            trackpoll_match = re.search(r"trackpollBootstrap\s*=\s*(\{.*?\});", detail_source, re.DOTALL)
            if trackpoll_match:
                try:
                    tp_data = json.loads(trackpoll_match.group(1))
                    flights_dict = tp_data.get("flights", {})
                    
                    if flights_dict:
                        first_flight_id = list(flights_dict.keys())[0]
                        flight_info = flights_dict[first_flight_id]
                        
                        # 真实起降校验
                        actual_orig = flight_info.get("origin", {}).get("iata", "Unknown")
                        actual_dest = flight_info.get("destination", {}).get("iata", "Unknown")
                        
                        if actual_orig != "Unknown" and actual_dest != "Unknown":
                            if actual_orig.upper() != origin.upper() or actual_dest.upper() != dest.upper():
                                is_direct_flight = False
                                print(f"    [跳过中转] 实际路径为 {actual_orig}-{actual_dest}")
                                
                        if is_direct_flight:
                            aircraft_data = flight_info.get("aircraft", {})
                            if aircraft_data:
                                aircraft_model = aircraft_data.get("friendlyType") or aircraft_data.get("type", "Unknown")
                                
                            speed_kts = flight_info.get("filed_airspeed_kts")
                            if speed_kts:
                                cruise_speed_kmh = str(int(float(speed_kts) * 1.852))
                except Exception:
                    pass

            if not is_direct_flight:
                continue 
            
            # 备用方案 (HTML文本匹配)
            if aircraft_model == "Unknown" or cruise_speed_kmh == "Unknown":
                text_content = detail_soup.get_text(separator=' ')
                if aircraft_model == "Unknown":
                    ac_match = re.search(r'(?:Aircraft Type|机型)\s+([A-Za-z0-9\-\s]+?)(?=\s+Registration|\s+Speed|\s+Owner)', text_content, re.IGNORECASE)
                    if ac_match: aircraft_model = ac_match.group(1).strip()
                if cruise_speed_kmh == "Unknown":
                    spd_match = re.search(r'(?:Speed|速度)\s+(\d+)\s*(?:kts|节)', text_content, re.IGNORECASE)
                    if spd_match: cruise_speed_kmh = str(int(int(spd_match.group(1)) * 1.852))

            # --- 步骤 3: 汇总结果 ---
            final_data.append({
                "route": f"{origin}-{dest}",
                "airline": flight['airline'],
                "ident": flight['ident'], # <--- 新增输出字段
                "aircraft_model": aircraft_model,
                "cruise_speed_kmh": cruise_speed_kmh
            })

    try:
        driver.quit()
    except:
        pass

    df = pd.DataFrame(final_data)
    # 调整列顺序，使其更美观
    if not df.empty:
        df = df[["route", "airline", "ident", "aircraft_model", "cruise_speed_kmh"]]
    return df

if __name__ == "__main__":
    print("开始抓取包含Ident的直飞航班数据...")
    result_df = scrape_flightaware_exact()
    
    if not result_df.empty:
        print("\n最终抓取结果如下：")
        print(result_df.to_string(index=False))
        result_df.to_csv("flightaware_with_ident.csv", index=False, encoding="utf-8-sig")
        print("\n数据已成功保存到 flightaware_with_ident.csv")
    else:
        print("\n未抓取到符合条件的数据。")