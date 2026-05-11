from http.server import BaseHTTPRequestHandler
import json
import mysql.connector
import os
import yfinance as yf
import pandas as pd

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
            
            # 获取最近 30 天油价
            wti = yf.Ticker("CL=F").history(period="1mo")['Close']
            brent = yf.Ticker("BZ=F").history(period="1mo")['Close']
            jet = yf.Ticker("HO=F").history(period="1mo")['Close'] * 42 

            df = pd.DataFrame({
                'wti_price': wti,
                'brent_price': brent,
                'jet_fuel_price': jet
            }).dropna()

            records = []
            for index, row in df.iterrows():
                date_str = index.strftime('%Y-%m-%d')
                records.append((date_str, round(row['wti_price'], 2), round(row['brent_price'], 2), round(row['jet_fuel_price'], 2)))
                
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