from http.server import BaseHTTPRequestHandler
import json
import mysql.connector
import os
import requests
from datetime import datetime

# 模拟获取 Yahoo Finance 数据的轻量级函数
def fetch_yahoo_finance(ticker):
    url = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=1mo&interval=1d"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    try:
        res = requests.get(url, headers=headers, timeout=10)
        data = res.json()
        result = {}
        if 'chart' in data and 'result' in data['chart'] and data['chart']['result']:
            result_data = data['chart']['result'][0]
            timestamps = result_data.get('timestamp', [])
            closes = result_data['indicators']['quote'][0].get('close', [])
            
            for t, c in zip(timestamps, closes):
                if c is not None:
                    # 将时间戳转换为 YYYY-MM-DD 格式
                    date_str = datetime.fromtimestamp(t).strftime('%Y-%m-%d')
                    result[date_str] = c
        return result
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        return {}

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            db = mysql.connector.connect(
                host=os.getenv("DB_HOST"),
                port=int(os.getenv("DB_PORT", 4000)),
                user=os.getenv("DB_USER"),
                password=os.getenv("DB_PASSWORD"),
                database=os.getenv("DB_NAME"),
                ssl_verify_cert=False,
                ssl_verify_identity=False
            )
            cursor = db.cursor()
            
            # 获取最近 30 天油价数据 (原生字典)
            wti_data = fetch_yahoo_finance("CL=F")
            brent_data = fetch_yahoo_finance("BZ=F")
            jet_data = fetch_yahoo_finance("HO=F")

            # 提取同时存在三种油价的公共日期 (等同于 pandas 的 dropna 逻辑)
            common_dates = set(wti_data.keys()) & set(brent_data.keys()) & set(jet_data.keys())
            
            records = []
            # 按日期排序整理数据
            for date_str in sorted(common_dates):
                wti = wti_data[date_str]
                brent = brent_data[date_str]
                jet = jet_data[date_str] * 42  # 航空燃油转换
                
                records.append((date_str, round(wti, 2), round(brent, 2), round(jet, 2)))
                
            if records:
                sql = """
                    REPLACE INTO oil_price_history 
                    (record_date, wti_price, brent_price, jet_fuel_price) 
                    VALUES (%s, %s, %s, %s)
                """
                cursor.executemany(sql, records)
                db.commit()

            cursor.close()
            db.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "updated_days": len(records)}).encode('utf-8'))
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))