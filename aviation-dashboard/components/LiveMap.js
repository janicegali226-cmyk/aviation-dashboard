"use client";

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polygon, GeoJSON, Tooltip as LeafletTooltip } from 'react-leaflet';
import * as turf from '@turf/turf';
import 'leaflet/dist/leaflet.css';

// 中东及全球核心航司映射字典
const AIRLINE_MAP = {
  QTR: "Qatar Airways",
  UAE: "Emirates",
  SIA: "Singapore Airlines",
  BAW: "British Airways",
  THA: "Thai Airways",
  CPA: "Cathay Pacific",
  MAS: "Malaysia Airlines",
  AIC: "Air India",
  OMA: "Oman Air",
  GFA: "Gulf Air",
  KAC: "Kuwait Airways",
  IRA: "Iran Air",
  ETD: "Etihad Airways",
  RJA: "Royal Jordanian",
  MSR: "EgyptAir",
  THY: "Turkish Airlines",
  ELY: "El Al Israel Airlines",
  SVA: "Saudia"
};

export default function LiveMap({ onFlightUpdate, onFlightSelect, selectedFlightIcao }) {
  const [flights, setFlights] = useState([]);
  const [clientCache, setClientCache] = useState({});
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchFlights = () => {
      // 🚨 终极缓存杀手：强制加上动态时间戳，并硬性指令不准读取缓存！
      fetch(`/api/flights?_t=${Date.now()}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          // 增加一层保护：如果后端返回报错，别让前端崩溃
          if (!Array.isArray(data)) {
            console.error("API returned non-array data:", data);
            return;
          }

          const now = Date.now();
          const recentFlights = data.filter(flight => {
            if (!flight.captured_at) return true; 
            
            // 强行补全 UTC 时区的 'Z' 标识！
            let timeStr = flight.captured_at;
            if (typeof timeStr === 'string' && !timeStr.endsWith('Z')) {
              timeStr = timeStr.replace(' ', 'T') + 'Z';
            }
            flight.captured_at = timeStr; 

            const flightTime = new Date(timeStr).getTime();
            // 过滤掉超过 60 分钟的数据
            return (now - flightTime) <= 24 * 60 * 60 * 1000;
          });
          
          setFlights(recentFlights);
          if (onFlightUpdate) onFlightUpdate(recentFlights.length);
        }).catch(err => console.error("Fetch error:", err));
    };
  }, [onFlightUpdate]);

  const noFlyZone = [ [27.5, 55.0], [26.5, 56.5], [25.5, 56.0], [26.0, 54.5], [27.0, 54.0] ];
  const AIRPORTS = { DXB: [55.3657, 25.2532], SIN: [103.9915, 1.3644], LHR: [-0.4543, 51.4700], BKK: [100.7501, 13.6900], HKG: [113.9185, 22.3080], KUL: [101.7099, 2.7456], BOM: [72.8656, 19.0896], DOH: [51.6080, 25.2731], DEL: [77.1000, 28.5562], MCT: [58.2844, 23.5933], TBZ: [46.2344, 38.1330], IKA: [51.1522, 35.4161], BAH: [50.6336, 26.2708], KWI: [47.9689, 29.2266] };
  const ROUTE_PAIRS = [ ['SIN', 'DXB'], ['LHR', 'DXB'], ['BKK', 'DXB'], ['HKG', 'DXB'], ['KUL', 'DXB'], ['SIN', 'LHR'], ['BOM', 'LHR'], ['DOH', 'SIN'], ['DEL', 'DXB'], ['MCT', 'DOH'], ['TBZ', 'IKA'], ['BAH', 'KWI'] ];

  const referenceRoutesGeoJSON = useMemo(() => ({
    type: "FeatureCollection",
    features: ROUTE_PAIRS.map(pair => {
      const name = `${pair[0]}-${pair[1]}`;
      const distanceKm = Math.round(turf.distance(
        turf.point(AIRPORTS[pair[0]]), 
        turf.point(AIRPORTS[pair[1]]), 
        { units: 'kilometers' }
      ));
      return turf.greatCircle(AIRPORTS[pair[0]], AIRPORTS[pair[1]], { 
        properties: { name, distanceKm } 
      });
    })
  }), []);

  const hasMatch = useMemo(() => {
    if (!searchQuery) return true;
    const queryUpper = searchQuery.toUpperCase();
    return ROUTE_PAIRS.some(pair => 
      `${pair[0]}-${pair[1]}`.includes(queryUpper) || 
      `${pair[1]}-${pair[0]}`.includes(queryUpper)
    );
  }, [searchQuery]);

  const getRouteStyle = (feature) => {
    if (!searchQuery) {
      return { color: '#3b82f6', weight: 2, opacity: 0.3, dashArray: '5, 8' };
    }
    const queryUpper = searchQuery.toUpperCase();
    const routeName = feature.properties.name;
    const reverseRouteName = routeName.split('-').reverse().join('-');
    
    const isMatch = routeName.includes(queryUpper) || reverseRouteName.includes(queryUpper);
    
    return {
      color: isMatch ? '#f97316' : '#3b82f6', 
      weight: isMatch ? 4 : 2,                
      opacity: isMatch ? 1 : 0.1,             
      dashArray: isMatch ? null : '5, 8'      
    };
  };

  // 飞机点击与详情数据获取逻辑
  const handleFlightClick = async (flight) => {
    const callsign = flight.callsign?.trim();
    if (!callsign) return;

    if (clientCache[callsign]) {
      onFlightSelect(clientCache[callsign]);
      return;
    }

    const airlineCode = callsign.substring(0, 3).toUpperCase();
    const airlineName = AIRLINE_MAP[airlineCode] || 'COMMERCIAL FLIGHT';

    onFlightSelect({ callsign, airlineName, loading: true, ...flight });

    try {
      const res = await fetch(`/api/flight-details?ident=${callsign}`);
      const apiData = res.ok ? await res.json() : { error: 'NO SCHEDULE DATA' };
      
      const enrichedData = { ...flight, ...apiData, airlineName, loading: false };
      onFlightSelect(enrichedData);
      setClientCache(prev => ({ ...prev, [callsign]: enrichedData }));
    } catch (err) {
      onFlightSelect({ ...flight, airlineName, error: 'API ERROR', loading: false });
    }
  };

  // 核心逻辑：计算并返回航班的视觉样式
  const getFlightVisuals = (flight) => {
    const isSelected = selectedFlightIcao === flight.icao24;

    if (isSelected) {
      return {
        radius: 8,
        pathOptions: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 1, weight: 3 },
        status: 'SELECTED'
      };
    }

    if (flight.captured_at) {
      const flightTime = new Date(flight.captured_at).getTime();
      const ageMinutes = (Date.now() - flightTime) / (1000 * 60);

      // 大于 30 分钟：判定为历史残影，显示为灰色半透明
      if (ageMinutes > 30) {
        return {
          radius: 5,
          pathOptions: { color: '#64748b', fillColor: '#64748b', fillOpacity: 0.4, weight: 1, opacity: 0.4 },
          status: 'GHOST'
        };
      }
    }

    // 默认或 30 分钟以内：判定为实时活跃，显示为高亮青色实心点
    return {
      radius: 5,
      pathOptions: { color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 1, weight: 1 },
      status: 'ACTIVE'
    };
  };

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-6 left-6 z-[1000] flex flex-col gap-2">
        <div className="flex bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg overflow-hidden shadow-2xl transition-all">
          <input 
            type="text" 
            placeholder="SEARCH ROUTE (e.g. SIN-DXB)" 
            className="bg-transparent text-white px-4 py-3 text-xs font-bold tracking-widest outline-none w-[280px] placeholder:text-slate-500 uppercase"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="px-4 text-slate-500 hover:text-white transition-colors">
              ✕
            </button>
          )}
        </div>
        
        {!hasMatch && searchQuery && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 text-[10px] font-bold px-3 py-2 rounded animate-pulse tracking-widest shadow-lg backdrop-blur">
            ⚠ ROUTE NOT FOUND IN CURRENT SECTOR
          </div>
        )}
        {hasMatch && searchQuery && (
          <div className="mt-1 flex flex-col gap-1">
            {referenceRoutesGeoJSON.features
              .filter(f => f.properties.name.includes(searchQuery.toUpperCase()) || f.properties.name.split('-').reverse().join('-').includes(searchQuery.toUpperCase()))
              .map((feature, idx) => (
                <div key={idx} className="bg-sky-500/20 border border-sky-500/50 text-sky-400 text-[10px] font-bold px-3 py-1.5 rounded backdrop-blur flex justify-between items-center">
                  <span>{feature.properties.name}</span>
                  <span>BASE DIST: {feature.properties.distanceKm} KM</span>
                </div>
            ))}
          </div>
        )}
      </div>

      <MapContainer center={[25.0, 55.0]} zoom={4} style={{ height: '100%', width: '100%', background: '#0a0f1c' }} zoomControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <Polygon positions={noFlyZone} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.2, dashArray: '5, 5' }} />
        
        <GeoJSON 
          key={searchQuery} 
          data={referenceRoutesGeoJSON} 
          style={getRouteStyle} 
          onEachFeature={(f, l) => l.bindTooltip(f.properties.name, {className: 'bg-slate-900 text-sky-400 border-slate-700 font-bold px-2 py-1 rounded'})} 
        />

        {flights.map((flight) => {
          const visuals = getFlightVisuals(flight);
          return (
            <CircleMarker
              key={flight.icao24}
              center={[flight.latitude, flight.longitude]}
              radius={visuals.radius}
              pathOptions={visuals.pathOptions}
              eventHandlers={{ click: () => handleFlightClick(flight) }}
            >
              <LeafletTooltip direction="top" offset={[0, -5]}>
                <div className="bg-slate-900 text-slate-100 p-2 rounded border border-slate-700">
                  <p className="font-bold text-sky-400">{flight.callsign || 'UNKNOWN'}</p>
                  {visuals.status === 'GHOST' && (
                    <p className="text-[10px] text-slate-400 mt-1 uppercase tracking-wider">Status: Historical ({'>'}30m)</p>
                  )}
                </div>
              </LeafletTooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}