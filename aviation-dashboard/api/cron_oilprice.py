from http.server import BaseHTTPRequestHandler
import json
import mysql.connector
import os
import requests
from datetime import datetime

# obtaining Yahoo Finance data
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
                    # Convert the timestamp to YYYY-MM-DD format
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
            
            # Get the oil price data of the last 30 days
            wti_data = fetch_yahoo_finance("CL=F")
            brent_data = fetch_yahoo_finance("BZ=F")
            jet_data = fetch_yahoo_finance("HO=F")

            # Extract the common date where three oil prices exist simultaneously
            common_dates = set(wti_data.keys()) & set(brent_data.keys()) & set(jet_data.keys())
            
            records = []
            # Sort the data by date
            for date_str in sorted(common_dates):
                wti = wti_data[date_str]
                brent = brent_data[date_str]
                jet = jet_data[date_str] * 42  # Aviation fuel conversion
                
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