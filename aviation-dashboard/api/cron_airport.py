from http.server import BaseHTTPRequestHandler
import json
import requests
import mysql.connector
import os

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
            
            API_KEY = "3b04224edf75f448be71bc143553bd3e"
            AIRPORTS = ["DXB", "DOH", "MCT", "KWI", "AUH", "IKA", "BAH", "TBZ", "SIN", "LHR", "BKK", "HKG", "BOM", "MEL"]
            url = "http://api.aviationstack.com/v1/flights"
            
            results = []
            for apt in AIRPORTS:
                params = {'access_key': API_KEY, 'dep_iata': apt, 'limit': 100}
                response = requests.get(url, params=params, timeout=10)
                
                if response.status_code == 200:
                    flights = response.json().get('data', [])
                    if flights:
                        total = len(flights)
                        cancelled = sum(1 for f in flights if f.get('flight_status') == 'cancelled')
                        diverted = sum(1 for f in flights if f.get('flight_status') == 'diverted')
                        
                        delayed = 0
                        total_delay_mins = 0
                        for f in flights:
                            dep = f.get('departure')
                            status = f.get('flight_status')
                            if dep and dep.get('delay') is not None:
                                delay_mins = dep.get('delay')
                                total_delay_mins += delay_mins
                                if delay_mins > 15 and status not in ['cancelled', 'diverted']:
                                    delayed += 1
                        
                        avg_delay = int(total_delay_mins / total) if total > 0 else 0
                        results.append((apt, total, avg_delay, cancelled, diverted, delayed))
            
            if results:
                sql = """
                    INSERT INTO hub_status_report 
                    (airport_code, total_samples, avg_delay_mins, cancelled_count, diverted_count, delayed_count) 
                    VALUES (%s, %s, %s, %s, %s, %s)
                """
                cursor.executemany(sql, results)
                db.commit()

            cursor.close()
            db.close()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success", "processed_airports": len(results)}).encode('utf-8'))
            
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))