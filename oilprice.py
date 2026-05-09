import requests
from bs4 import BeautifulSoup
import mysql.connector
from datetime import datetime
import yfinance as yf
from apscheduler.schedulers.blocking import BlockingScheduler
import pandas as pd
import os

# 数据库配置
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", 4000)),  # 明确指向 TiDB 的 4000 端口
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
    "ssl_verify_cert": True,                  # 开启 SSL 证书验证
    "ssl_verify_identity": True               # 开启 SSL 身份验证 (TiDB 必须要求)
}

# 获取战前（2026.02）油价数据
def backfill_february_history():
    """
    通过 Yahoo Finance API 获取真实的 2026年2月 油价数据，并补充到 SQL 数据库。
    """
    print(f"[{datetime.now()}] ⏳ 正在通过 Yahoo Finance 下载 2026年2月 的真实历史油价...")
    
    # 1. 获取 2026 年 2 月的数据 (start 包含，end 不包含)
    wti = yf.Ticker("CL=F").history(start="2026-02-01", end="2026-03-01")['Close']
    brent = yf.Ticker("BZ=F").history(start="2026-02-01", end="2026-03-01")['Close']
    jet = yf.Ticker("HO=F").history(start="2026-02-01", end="2026-03-01")['Close'] * 42 

    # 2. 使用 Pandas 将三列数据按日期对齐合并，并剔除周末/节假日的空缺值
    df = pd.DataFrame({
        'wti_price': wti,
        'brent_price': brent,
        'jet_fuel_price': jet
    }).dropna()

    # 3. 格式化数据准备插入数据库
    records = []
    for index, row in df.iterrows():
        # yfinance 返回的 index 是带时区的 DatetimeIndex，转换为 YYYY-MM-DD 格式
        date_str = index.strftime('%Y-%m-%d')
        records.append((
            date_str, 
            round(row['wti_price'], 2), 
            round(row['brent_price'], 2), 
            round(row['jet_fuel_price'], 2)
        ))
        
    if not records:
        print("⚠️ 未获取到 2026年2月 的有效交易数据，请检查网络或 API 状态。")
        return

    # 4. 连接数据库并执行 INSERT IGNORE
    db = mysql.connector.connect(**DB_CONFIG)
    cursor = db.cursor()
    try:
        # 使用 IGNORE，如果这些日期的数据已经存在，就不会重复插入，防止主键冲突
        sql = """
            INSERT IGNORE INTO oil_price_history 
            (record_date, wti_price, brent_price, jet_fuel_price) 
            VALUES (%s, %s, %s, %s)
        """
        cursor.executemany(sql, records)
        db.commit()
        
        if cursor.rowcount > 0:
            print(f"✅ 成功从 Yahoo Finance 抓取并补充了 {cursor.rowcount} 个交易日的 2026年2月 真实数据！")
        else:
            print("ℹ️ 2026年2月的数据已在数据库中，无需重复回填。")
            
    except Exception as e:
        print(f"❌ 历史数据补全入库失败: {e}")
    finally:
        cursor.close()
        db.close()

def fetch_30d_history():
    print(f"[{datetime.now()}] 正在下载过去 30 天的国际油价数据...")
    
    # 1. 获取 1 个月的数据 (1mo)
    wti = yf.Ticker("CL=F").history(period="1mo")['Close']
    brent = yf.Ticker("BZ=F").history(period="1mo")['Close']
    # 航空燃油影子价格：美元/加仑 转换为 美元/桶 (* 42)
    jet = yf.Ticker("HO=F").history(period="1mo")['Close'] * 42 

    # 2. 使用 Pandas 将三列数据按日期对齐合并，并剔除空缺值
    df = pd.DataFrame({
        'wti_price': wti,
        'brent_price': brent,
        'jet_fuel_price': jet
    }).dropna()

    # 3. 格式化数据准备插入数据库
    records = []
    for index, row in df.iterrows():
        # 提取 YYYY-MM-DD 格式的日期
        date_str = index.strftime('%Y-%m-%d')
        records.append((
            date_str, 
            round(row['wti_price'], 2), 
            round(row['brent_price'], 2), 
            round(row['jet_fuel_price'], 2)
        ))
        
    return records

if __name__ == "__main__":
    # 1. 先去抓取最近 30 天的动态数据
    records = fetch_30d_history()
    
    if records:
        try:
            db = mysql.connector.connect(**DB_CONFIG)
            cursor = db.cursor()
            
            # 🛑 删掉了 TRUNCATE TABLE！绝对不能清空整张表了！
            
            # 💡 改用 REPLACE INTO (或者 INSERT IGNORE)
            # 如果某天的数据已经存在，就用最新的价格覆盖它；如果不存在，就新增。
            # 这样既能更新近 30 天的数据，又绝对不会误伤已经躺在表里的 2 月份历史数据！
            sql = """
                REPLACE INTO oil_price_history 
                (record_date, wti_price, brent_price, jet_fuel_price) 
                VALUES (%s, %s, %s, %s)
            """
            cursor.executemany(sql, records)
            db.commit()
            print(f"✅ 成功将 {len(records)} 天的近期油价数据更新入 MySQL！")
            
        except Exception as e:
            print(f"❌ 数据库保存失败: {e}")
        finally:
            if 'cursor' in locals(): cursor.close()
            if 'db' in locals(): db.close()

    # 2. 💥 关键调用位置：放在这里独立运行
    # 因为 backfill 函数内部写的是 INSERT IGNORE，
    # 所以它只有在第一次运行时会把 2 月数据塞进去，以后再运行都会自动跳过，不浪费网络请求！
    backfill_february_history()