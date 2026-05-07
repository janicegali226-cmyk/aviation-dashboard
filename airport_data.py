import requests
import os
import sys
import time
from datetime import datetime
import mysql.connector

# ==========================================
# 🛡️ 熔断器配置 (Circuit Breaker Config)
# ==========================================
LOCK_FILE = "aviation_api_breaker.lock"
LOCK_DURATION_HOURS = 24  # 一旦触发，死锁 24 小时禁止调用

def check_circuit_breaker():
    """每次发起 API 请求前，先检查系统是否处于熔断状态"""
    if os.path.exists(LOCK_FILE):
        file_mtime = os.path.getmtime(LOCK_FILE)
        # 判断锁文件是否在设定的有效死锁期内
        if (time.time() - file_mtime) < (LOCK_DURATION_HOURS * 3600):
            print(f"[{datetime.now()}] 🛑 熔断器处于 [开启] 状态！")
            print(f"为了保护账号，程序已主动拦截本次请求。请等待 24 小时，或手动删除 {LOCK_FILE}。")
            # 极其关键：用 sys.exit(0) 代表“正常安全退出”，千万不能报错抛出异常，
            # 否则会被外层的 PM2 误判为意外崩溃而疯狂重启！
            sys.exit(0) 
        else:
            # 超过 24 小时，锁过期了，系统自动摘除警报
            os.remove(LOCK_FILE)
            print(f"[{datetime.now()}] 🟢 熔断时间已过，自动解除警报，恢复 API 调用。")

def trigger_circuit_breaker(reason):
    """遭遇危机，立刻拉下电闸（生成物理锁文件）"""
    with open(LOCK_FILE, "w") as f:
        f.write(f"Tripped at {datetime.now()} Reason: {reason}")
    print(f"\n[{datetime.now()}] 🚨 致命警告：触发系统熔断！")
    print(f"原因: {reason}")
    print("电闸已拉下，后续所有请求将被直接静默拦截。")
# ==========================================

# ==========================================
# 1. 基础配置
# ==========================================
API_KEY = "3b04224edf75f448be71bc143553bd3e"
AIRPORTS = [
    "DXB", "DOH", "MCT", "KWI", "AUH", "IKA", "BAH", "TBZ", 
    "SIN", "LHR", "BKK", "HKG", "BOM", "MEL"
]

DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "ljn200326", 
    "database": "aviation_dashboard"
}

# ==========================================
# 2. 核心分析逻辑 (只取最确切的指标)
# ==========================================
def fetch_and_calculate(airport_code):
    url = "http://api.aviationstack.com/v1/flights"
    params = {
        'access_key': API_KEY,
        'dep_iata': airport_code,
        'limit': 100  # 固定提取 100 个样本
    }
    
    try:
        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            flights = response.json().get('data', [])
            if not flights:
                return None
                
            total = len(flights)
            cancelled = 0
            diverted = 0
            delayed = 0
            total_delay_mins = 0
            
            for f in flights:
                status = f.get('flight_status')
                
                # 1. 统计取消与备降 (API原生明确状态)
                if status == 'cancelled':
                    cancelled += 1
                elif status == 'diverted':
                    diverted += 1
                
                # 2. 统计延误逻辑
                dep = f.get('departure')
                if dep and dep.get('delay') is not None:
                    delay_mins = dep.get('delay')
                    total_delay_mins += delay_mins
                    
                    # 逻辑计算：延误超 15 分钟，且没有被取消和备降，才算作“单纯的延误航班”
                    if delay_mins > 15 and status not in ['cancelled', 'diverted']:
                        delayed += 1
                        
            # 3. 计算平均延误时间
            avg_delay = int(total_delay_mins / total) if total > 0 else 0
            
            return (airport_code, total, avg_delay, cancelled, diverted, delayed)
        else:
            if response.status_code == 429:
                trigger_circuit_breaker("HTTP 429 - 免费 API 额度已彻底耗尽！")
                sys.exit(0)
            elif response.status_code == 403:
                trigger_circuit_breaker("HTTP 403 - 接口权限被拒绝！")
                sys.exit(0)
            else:
                print(f"[{airport_code}] 请求错误: {response.status_code}")
                return None
    except Exception as e:
        print(f"[{airport_code}] 网络/解析异常: {e}")
        return None

# ==========================================
# 3. 主程序与安全锁
# ==========================================
if __name__ == "__main__":
    # 每次开工前，先检查电闸有没有被拉下！
    check_circuit_breaker() 

    results = []
    for apt in AIRPORTS:
        print(f"正在分析 {apt}...")
        metrics = fetch_and_calculate(apt)
        if metrics:
            print(f"   => 样本:{metrics[1]} | 平均延误:{metrics[2]}m | 取消:{metrics[3]} | 备降:{metrics[4]} | 晚点:{metrics[5]}")
            results.append(metrics)

    # 存入数据库
    if results:
        try:
            db = mysql.connector.connect(**DB_CONFIG)
            cursor = db.cursor()
            sql = """
                INSERT INTO hub_status_report 
                (airport_code, total_samples, avg_delay_mins, cancelled_count, diverted_count, delayed_count) 
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.executemany(sql, results)
            db.commit()
            print("\n✅ 数据清洗与快照完成！成功存入 MySQL。")
        except Exception as e:
            print(f"\n❌ 数据库保存失败: {e}")
        finally:
            if 'cursor' in locals(): cursor.close()
            if 'db' in locals(): db.close()