from http.server import BaseHTTPRequestHandler
import json
import requests
import mysql.connector
from datetime import datetime
import os
from requests.auth import HTTPBasicAuth

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            # 1. 连接云端数据库
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
            
            # 2. OpenSky API 配置
            OPENSKY_USER = os.getenv("OPENSKY_USER", "janice")
            OPENSKY_PASS = os.getenv("OPENSKY_PASS", "Ljn200326&gali")
            TARGET_URL = "https://opensky-network.org/api/states/all?lamin=10.0&lomin=35.0&lamax=45.0&lomax=80.0"
            auth = HTTPBasicAuth(OPENSKY_USER, OPENSKY_PASS) if OPENSKY_USER else None
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            }
            
            # 3. 抓取数据
            # 👇 修改这一行，加上 headers=headers，改 timeout=10 👇
            response = requests.get(TARGET_URL, auth=auth, headers=headers, timeout=10)
            inserted_count = 0
            
            if response.status_code == 200:
                states = response.json().get("states")
                if states:
                    sql = """
                        INSERT INTO flight_data 
                        (icao24, callsign, latitude, longitude, velocity, true_track) 
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    values = []
                    for f in states:
                        if f[1] and f[5] and f[6]:
                            callsign = f[1].strip()
                            if callsign:
                                values.append((f[0], callsign, f[6], f[5], f[9], f[10]))
                    
                    if values:
                        cursor.executemany(sql, values)
                        db.commit()
                        inserted_count = len(values)
            
            cursor.close()
            db.close()
            
            # 4. 返回 Vercel 成功信号
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "success", 
                "message": f"Fetched and stored {inserted_count} flights."
            }).encode('utf-8'))
            
        except Exception as e:
            # 返回报错信号
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))