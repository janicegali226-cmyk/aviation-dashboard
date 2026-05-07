import time
import json
import random
import re
import pandas as pd
from bs4 import BeautifulSoup
import undetected_chromedriver as uc

def scrape_all_direct_flights_stable():
    routes = [
        ('SIN', 'DXB'), ('LHR', 'DXB'), ('BKK', 'DXB'), ('HKG', 'DXB'),
        ('DOH', 'SIN'), ('SIN', 'LHR'), ('BOM', 'DXB'), ('MEL', 'DXB')
    ]
    
    options = uc.ChromeOptions()
    options.add_argument('--lang=en-US')
    options.add_experimental_option('prefs', {'intl.accept_languages': 'en-US,en'})
    
    try:
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
        # 等待网页 AJAX 渲染完成 HTML 表格
        time.sleep(random.uniform(6, 9)) 
        
        page_source = driver.page_source
        soup = BeautifulSoup(page_source, 'html.parser')
        
        flight_links = []
        
        # 1. 回归 aircraft.py 最稳定的 DOM 提取法 (无视航司限制)
        rows = soup.find_all('tr')
        for row in rows:
            links = row.find_all('a', href=True)
            for a in links:
                href = a['href']
                # 只要是航班详情页链接，统统拿下
                if '/live/flight/' in href and 'history' not in href and '?' not in href:
                    ident = a.get_text(strip=True)
                    # 过滤掉一些空链接或非航班号链接
                    if ident and len(ident) > 2: 
                        full_url = "https://www.flightaware.com" + href if href.startswith('/') else href
                        flight_links.append({
                            "ident": ident,
                            "url": full_url
                        })
                        break # 一行取一个核心链接即可
                
        # 去重相同链接
        unique_links = {link['url']: link for link in flight_links}.values()
        print(f"[{origin}-{dest}] 页面上捕捉到 {len(unique_links)} 个航班链接，准备进入详情页校验直飞...")

        for flight in unique_links:
            print(f" -> 正在查询航班: {flight['ident']} ...")
            
            driver.get(flight['url'])
            time.sleep(random.uniform(4, 7))
            
            detail_source = driver.page_source
            detail_soup = BeautifulSoup(detail_source, 'html.parser')
            
            airline_name = "Unknown"
            aircraft_model = "Unknown"
            cruise_speed_kmh = "Unknown"
            is_direct_flight = True 
            
            # 2. 详情页数据提取与直飞校验 (完全沿用 aircraft.py 中被证明成功的方法)
            trackpoll_match = re.search(r"trackpollBootstrap\s*=\s*(\{.*?\});", detail_source, re.DOTALL)
            if trackpoll_match:
                try:
                    tp_data = json.loads(trackpoll_match.group(1))
                    flights_dict = tp_data.get("flights", {})
                    
                    if flights_dict:
                        first_flight_id = list(flights_dict.keys())[0]
                        flight_info = flights_dict[first_flight_id]
                        
                        # 【核心校验】真实起降校验
                        actual_orig = flight_info.get("origin", {}).get("iata", "Unknown")
                        actual_dest = flight_info.get("destination", {}).get("iata", "Unknown")
                        
                        if actual_orig != "Unknown" and actual_dest != "Unknown":
                            if actual_orig.upper() != origin.upper() or actual_dest.upper() != dest.upper():
                                is_direct_flight = False
                                print(f"    [跳过中转] 该航段实际路径为 {actual_orig}-{actual_dest}")
                                
                        if is_direct_flight:
                            # 提取航司名称
                            airline_data = flight_info.get("airline", {})
                            if airline_data:
                                airline_name = airline_data.get("shortName") or airline_data.get("fullName", "Unknown")

                            # 提取机型
                            aircraft_data = flight_info.get("aircraft", {})
                            if aircraft_data:
                                aircraft_model = aircraft_data.get("friendlyType") or aircraft_data.get("type", "Unknown")
                                
                            # 提取速度
                            speed_kts = flight_info.get("filed_airspeed_kts")
                            if speed_kts:
                                cruise_speed_kmh = str(int(float(speed_kts) * 1.852))
                except Exception:
                    pass

            # 如果判定为中转，直接跳过不记录
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

            # 追加有效直飞数据
            final_data.append({
                "route": f"{origin}-{dest}",
                "airline": airline_name, # 使用详情页提取出的准确航司名
                "ident": flight['ident'],
                "aircraft_model": aircraft_model,
                "cruise_speed_kmh": cruise_speed_kmh
            })

    try:
        driver.quit()
    except OSError:
        pass

    df = pd.DataFrame(final_data)
    if not df.empty:
        df = df[["route", "airline", "ident", "aircraft_model", "cruise_speed_kmh"]]
    return df

if __name__ == "__main__":
    print("开始抓取全航司直飞航班数据 (基于稳健 HTML 解析)...")
    result_df = scrape_all_direct_flights_stable()
    
    if not result_df.empty:
        print("\n最终抓取结果如下：")
        print(result_df.to_string(index=False))
        result_df.to_csv("flightaware_stable_direct_flights.csv", index=False, encoding="utf-8-sig")
        print("\n完美！数据已成功保存到 flightaware_stable_direct_flights.csv")
    else:
        print("\n未抓取到符合条件的数据。")