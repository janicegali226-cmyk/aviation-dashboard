from http.server import BaseHTTPRequestHandler
import json
import csv
import mysql.connector
from datetime import datetime
import random
import math
import os
import requests
import re

# ==========================================
# 1. 数据库配置与物理距离
# ==========================================
DB_CONFIG = {
    "host": os.getenv("DB_HOST"),
    "port": int(os.getenv("DB_PORT", 4000)),
    "user": os.getenv("DB_USER"),
    "password": os.getenv("DB_PASSWORD"),
    "database": os.getenv("DB_NAME"),
    "ssl_verify_cert": False,
    "ssl_verify_identity": False
}

AIRPORT_COORDS = {
    'SIN': (1.3644, 103.9915),   
    'DXB': (25.2532, 55.3657),   
    'LHR': (51.4700, -0.4543),   
    'BKK': (13.6900, 100.7501),  
    'HKG': (22.3080, 113.9185),  
    'DOH': (25.2731, 51.6080),   
    'BOM': (19.0896, 72.8656),   
    'MEL': (-37.6690, 144.8410)  
}

def calculate_great_circle_distance(route):
    try:
        origin, dest = route.split('-')
        lat1, lon1 = AIRPORT_COORDS[origin]
        lat2, lon2 = AIRPORT_COORDS[dest]

        R = 6371.0
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)

        dlon = lon2_rad - lon1_rad
        dlat = lat2_rad - lat1_rad
        
        a = math.sin(dlat / 2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon / 2)**2
        c = 2 * math.asin(math.sqrt(a))
        return round(R * c, 2)
    except Exception as e:
        return None

# ==========================================
# 2. 内嵌极速防超时爬虫 & 数据获取
# ==========================================
def get_oil_prices(cursor):
    try:
        cursor.execute("SELECT jet_fuel_price FROM oil_price_history WHERE jet_fuel_price IS NOT NULL ORDER BY record_date DESC LIMIT 1")
        latest = cursor.fetchone()
        current_price = float(latest['jet_fuel_price']) if latest and latest.get('jet_fuel_price') is not None else 159.36
        
        cursor.execute("SELECT AVG(jet_fuel_price) AS avg_price FROM oil_price_history WHERE jet_fuel_price IS NOT NULL AND record_date >= '2026-02-01' AND record_date < '2026-03-01'")
        baseline = cursor.fetchone()
        baseline_price = float(baseline['avg_price']) if baseline and baseline.get('avg_price') is not None else 115.40
        
        return current_price, baseline_price
    except Exception:
        return 159.36, 115.40

def fetch_flightaware_lightweight(ident):
    """超轻量替代方案：原生requests+正则，强制1.5秒超时防崩溃"""
    url = f"https://www.flightaware.com/live/flight/{ident}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"
    }
    try:
        # 🚨 核心保命机制：最多只等1.5秒，拿不到直接跳过，防止Vercel被10秒强杀！
        res = requests.get(url, headers=headers, timeout=1.5)
        if res.status_code == 200:
            match = re.search(r'trackpollBootstrap\s*=\s*({.+?});\s*</script>', res.text, re.DOTALL)
            if match:
                raw_data = json.loads(match.group(1))
                flights = raw_data.get("flights", {})
                if flights:
                    flight_id = list(flights.keys())[0]
                    flight = flights[flight_id]
                    return flight.get("flightPlan", {}).get("ete")
    except Exception:
        pass
    return None

def fetch_realtime_flight_data(ident, route, baseline_air_time):
    actual_air_time = baseline_air_time 
    try:
        duration_seconds = fetch_flightaware_lightweight(ident)
        if duration_seconds and isinstance(duration_seconds, (int, float)) and duration_seconds > 0:
            actual_air_time = duration_seconds / 3600.0
    except Exception:
        pass
    
    war_risk = 5000 if 'DXB' in route or 'DOH' in route else 0
    long_haul_routes = ['SIN-LHR', 'MEL-DXB', 'LHR-DXB', 'DOH-SIN']
    extra_stop = random.choices([0, 1000], weights=[70, 30])[0] if route in long_haul_routes else 0
        
    return actual_air_time, 0, war_risk, extra_stop

# ==========================================
# 3. 核心核算引擎
# ==========================================
def calculate_matrix_data():
    db = mysql.connector.connect(**DB_CONFIG)
    cursor = db.cursor(dictionary=True)

    current_oil_price, baseline_oil_price = get_oil_prices(cursor)

    current_dir = os.path.dirname(os.path.abspath(__file__))
    csv_path = os.path.join(current_dir, 'routes1.csv')
    
    unique_flights = {}
    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        reader.fieldnames = [name.strip() for name in reader.fieldnames]
        for row in reader:
            ident = row.get('ident')
            if ident and ident not in unique_flights:
                unique_flights[ident] = row
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cost_matrix_data (
            airline VARCHAR(100), route VARCHAR(50), ident VARCHAR(20), aircraft VARCHAR(100),
            fluctuation_pct FLOAT, extra_fuel FLOAT, extra_crew FLOAT, baseline_air_time FLOAT,
            baseline_fuel_cost FLOAT, baseline_crew_cost FLOAT, actual_air_time FLOAT,
            current_fuel_cost FLOAT, current_crew_cost FLOAT, war_risk FLOAT, extra_stop FLOAT,
            delay_comp FLOAT, update_time DATETIME, PRIMARY KEY (airline, route, ident)
        )
    """)

    matrix_records = []
    taxi_time_constant = 0.6 
    crew_hourly_wage = 180.0 

    for row in unique_flights.values():
        route = row['route']
        distance_in_theory = calculate_great_circle_distance(route)
        distance = distance_in_theory * 1.06 if distance_in_theory else None
        
        if not distance: continue
            
        speed = float(row['cruise_speed_kmh'])
        fuel_burn_bbl = float(row['fuel_burn_gal_per_hr']) / 42.0 
        crew_size = float(row['standard_crew_size'])
        max_pax = float(row['max_pax_capacity'])

        baseline_air_time = distance / speed if speed > 0 else 0
        baseline_block_time = baseline_air_time + taxi_time_constant
        baseline_fuel_cost = baseline_air_time * fuel_burn_bbl * baseline_oil_price
        baseline_crew_cost = baseline_block_time * crew_size * crew_hourly_wage
        baseline_cost = baseline_fuel_cost + baseline_crew_cost
        
        actual_air_time, delay_mins, war_risk, extra_stop = fetch_realtime_flight_data(row['ident'], route, baseline_air_time)
        actual_block_time = actual_air_time + taxi_time_constant
        
        delay_comp = 250 * max_pax if delay_mins >= 180 else (150 * max_pax if 90 <= delay_mins < 180 else 0)
        current_fuel_cost = actual_air_time * fuel_burn_bbl * current_oil_price
        current_crew_cost = actual_block_time * crew_size * crew_hourly_wage

        extra_fuel = round(current_fuel_cost - baseline_fuel_cost, 2)
        extra_crew = round(current_crew_cost - baseline_crew_cost, 2)
        current_cost = current_fuel_cost + current_crew_cost + delay_comp + war_risk + extra_stop

        fluctuation_pct = ((current_cost - baseline_cost) / baseline_cost) * 100 if baseline_cost > 0 else 0.0
        
        matrix_records.append((
            row['airline'], route, row['ident'], row['aircraft_model'], round(fluctuation_pct, 1),
            extra_fuel, extra_crew, float(war_risk), float(extra_stop), float(delay_comp),
            round(baseline_air_time, 2), round(baseline_fuel_cost, 2), round(baseline_crew_cost, 2),
            round(actual_air_time, 2), round(current_fuel_cost, 2), round(current_crew_cost, 2), datetime.now()
        ))

    cursor.execute("TRUNCATE TABLE cost_matrix_data")
    sql = """
        REPLACE INTO cost_matrix_data 
        (airline, route, ident, aircraft, fluctuation_pct, extra_fuel, extra_crew, war_risk, extra_stop, delay_comp,
         baseline_air_time, baseline_fuel_cost, baseline_crew_cost, actual_air_time, current_fuel_cost, current_crew_cost, update_time) 
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    cursor.executemany(sql, matrix_records)
    db.commit()
    
    count = len(matrix_records)
    cursor.close()
    db.close()
    return count

# ==========================================
# 4. 包装为 Vercel 接口
# ==========================================
class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            processed_count = calculate_matrix_data()
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "status": "success", 
                "message": f"Successfully updated {processed_count} cost matrix records!"
            }).encode('utf-8'))
        except Exception as e:
            self.send_response(500)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))