import requests
import mysql.connector
import time
from datetime import datetime
from requests.auth import HTTPBasicAuth
import os

# 1. 配置数据库连接
DB_CONFIG = {
    "host": "localhost",       # 如果数据库在 AWS RDS 或其他云上，替换为对应的 Endpoint
    "user": "root",
    "password": "ljn200326",
    "database": "aviation_dashboard"
}

# 2. 配置 OpenSky API
# 如果有 OpenSky 账号，填写在这里以获得更高调用频率；没有则保持 None
OPENSKY_USER = "janice"
OPENSKY_PASS = "Ljn200326&gali"

OPENSKY_BASE_URL = "https://opensky-network.org/api/states/all"

# 设定抓取范围：伊朗及霍尔木兹海峡周边
TARGET_URL = f"{OPENSKY_BASE_URL}?lamin=10.0&lomin=35.0&lamax=45.0&lomax=80.0"


def connect_to_db():
    """建立并返回数据库连接"""
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"[{datetime.now()}] 数据库连接失败: {err}")
        return None

def fetch_and_store_flights():
    """直接请求 OpenSky API 抓取数据并存入 MySQL"""
    db = connect_to_db()
    if not db:
        return

    cursor = db.cursor()
    
    try:
        print(f"[{datetime.now()}] 正在直接请求 OpenSky API...")
        
        # 配置身份验证（如果有）
        auth = HTTPBasicAuth(OPENSKY_USER, OPENSKY_PASS) if OPENSKY_USER else None
        
        # 直接发送 GET 请求，不再经过代理
        response = requests.get(TARGET_URL, auth=auth, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            states = data.get("states")
            
            if states:
                sql = """
                    INSERT INTO flight_data 
                    (icao24, callsign, latitude, longitude, velocity, true_track) 
                    VALUES (%s, %s, %s, %s, %s, %s)
                """
                values = []
                
                for f in states:
                    # 索引含义: 0:icao24, 1:callsign, 5:lon, 6:lat, 9:velocity, 10:true_track
                    if f[1] and f[5] and f[6]:
                        callsign = f[1].strip()
                        if callsign:
                            values.append((f[0], callsign, f[6], f[5], f[9], f[10]))
                
                if values:
                    cursor.executemany(sql, values)
                    db.commit()
                    print(f"[{datetime.now()}] 成功抓取并储存了 {len(values)} 架航班的位置。")
            else:
                print(f"[{datetime.now()}] 该区域当前无航班信号。")
                
        elif response.status_code == 403:
            print(f"[{datetime.now()}] 错误 403：访问被拒绝。可能是该 IP 请求过快，建议注册账号或稍后再试。")
        elif response.status_code == 429:
            print(f"[{datetime.now()}] 错误 429：触发频率限制。")
        else:
            print(f"[{datetime.now()}] API 请求失败，状态码: {response.status_code}")

    except requests.exceptions.RequestException as e:
        print(f"[{datetime.now()}] 网络请求错误: {e}")
    except mysql.connector.Error as err:
        print(f"[{datetime.now()}] 数据库插入错误: {err}")
    finally:
        cursor.close()
        db.close()

# 3. 设定主程序：每小时自动运行 1 次
if __name__ == "__main__":
    print(f"[{datetime.now()}] 实时航班直连抓取服务已启动...")
    fetch_and_store_flights()
    print(f"[{datetime.now()}] 任务完成！")