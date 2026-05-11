from http.server import BaseHTTPRequestHandler
import json
import requests
import mysql.connector
from datetime import datetime
import os

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
                ssl_verify_cert=False,    # 保持轻量级忽略本地证书
                ssl_verify_identity=False
            )
            cursor = db.cursor()
            
            # 2. AirLabs API 配置
            AIRLABS_API_KEY = os.getenv("AIRLABS_API_KEY")
            if not AIRLABS_API_KEY:
                raise ValueError("Missing AIRLABS_API_KEY in environment variables.")
                
            # bbox 边界框: south_lat, west_lng, north_lat, east_lng (对应你之前的中东区域)
            TARGET_URL = f"https://airlabs.co/api/v9/flights?bbox=10.0,35.0,45.0,80.0&api_key={AIRLABS_API_KEY}"
            
            # 3. 抓取数据 (设置强制超时保护，Vercel 友好)
            response = requests.get(TARGET_URL, timeout=8)
            inserted_count = 0
            
            if response.status_code == 200:
                data = response.json()
                flights = data.get("response", [])
                
                if flights:
                    sql = """
                        INSERT INTO flight_data 
                        (icao24, callsign, latitude, longitude, velocity, true_track) 
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    values = []
                    for f in flights:
                        hex_code = f.get('hex')
                        callsign = f.get('flight_icao') or f.get('reg_number')
                        lat = f.get('lat')
                        lng = f.get('lng')
                        speed_kmh = f.get('speed', 0)
                        dir_track = f.get('dir', 0)
                        
                        # 确保关键数据存在
                        if hex_code and callsign and lat and lng:
                            # 自动将 AirLabs 的 km/h 换算为 m/s，无缝对接你的前端逻辑
                            velocity_ms = round(speed_kmh * (1000 / 3600), 2)
                            values.append((hex_code, callsign.strip(), lat, lng, velocity_ms, dir_track))
                    
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
                "message": f"Fetched and stored {inserted_count} flights via AirLabs."
            }).encode('utf-8'))
            
        except Exception as e:
            # 返回报错信号
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))