"use client";

import { useEffect, useState, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polygon, GeoJSON, Tooltip as LeafletTooltip } from 'react-leaflet';
import * as turf from '@turf/turf';
import 'leaflet/dist/leaflet.css';

const AIRLINE_MAP = {
  QTR: "Qatar Airways", UAE: "Emirates", SIA: "Singapore Airlines", BAW: "British Airways",
  THA: "Thai Airways", CPA: "Cathay Pacific", MAS: "Malaysia Airlines", AIC: "Air India",
  OMA: "Oman Air", GFA: "Gulf Air", KAC: "Kuwait Airways", IRA: "Iran Air",
  ETD: "Etihad Airways", RJA: "Royal Jordanian", MSR: "EgyptAir", THY: "Turkish Airlines",
  ELY: "El Al Israel Airlines", SVA: "Saudia"
};

export default function LiveMap({ onFlightUpdate, onFlightSelect, selectedFlightIcao }) {
  const [flights, setFlights] = useState([]);
  const [clientCache, setClientCache] = useState({});
  const [searchQuery, setSearchQuery] = useState("");
  // 1. 增加当前时间状态（用于右上角时钟）
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const fetchFlights = () => {
      fetch(`/api/flights?_t=${Date.now()}`, { cache: 'no-store' })
        .then(res => res.json())
        .then(data => {
          if (!Array.isArray(data)) return;

          const now = Date.now();
          const recentFlights = data.filter(flight => {
            if (!flight.captured_at) return true; 
            let timeStr = flight.captured_at;
            if (typeof timeStr === 'string' && !timeStr.endsWith('Z')) {
              timeStr = timeStr.replace(' ', 'T') + 'Z';
            }
            flight.captured_at = timeStr; 
            const flightTime = new Date(timeStr).getTime();
            return (now - flightTime) <= 24 * 60 * 60 * 1000;
          });
          
          setFlights(recentFlights);
          if (onFlightUpdate) onFlightUpdate(recentFlights.length);
        }).catch(err => console.error("Fetch error:", err));
    };

    fetchFlights();
    const fetchInterval = setInterval(fetchFlights, 3 * 60 * 1000);
    
    // 2. 增加每秒更新一次的计时器
    const clockInterval = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    return () => {
      clearInterval(fetchInterval);
      clearInterval(clockInterval);
    };
  }, []);

  // 3. 计算最新数据的更新时间
  const lastDataUpdateTime = useMemo(() => {
    if (flights.length === 0) return "N/A";
    const times = flights.map(f => new Date(f.captured_at).getTime());
    const latest = new Date(Math.max(...times));
    return latest.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  }, [flights]);

  // 4. 格式化当前东八区时间
  const formattedCurrentTime = useMemo(() => {
    return currentTime.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  }, [currentTime]);

  const noFlyZone = [ [27.5, 55.0], [26.5, 56.5], [25.5, 56.0], [26.0, 54.5], [27.0, 54.0] ];
  const AIRPORTS = { DXB: [55.3657, 25.2532], SIN: [103.9915, 1.3644], LHR: [-0.4543, 51.4700], BKK: [100.7501, 13.6900], HKG: [113.9185, 22.3080], KUL: [101.7099, 2.7456], BOM: [72.8656, 19.0896], DOH: [51.6080, 25.2731], DEL: [77.1000, 28.5562], MCT: [58.2844, 23.5933], TBZ: [46.2344, 38.1330], IKA: [51.1522, 35.4161], BAH: [50.6336, 26.2708], KWI: [47.9689, 29.2266] };
  const ROUTE_PAIRS = [ ['SIN', 'DXB'], ['LHR', 'DXB'], ['BKK', 'DXB'], ['HKG', 'DXB'], ['KUL', 'DXB'], ['SIN', 'LHR'], ['BOM', 'LHR'], ['DOH', 'SIN'], ['DEL', 'DXB'], ['MCT', 'DOH'], ['TBZ', 'IKA'], ['BAH', 'KWI'] ];

  const referenceRoutesGeoJSON = useMemo(() => ({
    type: "FeatureCollection",
    features: ROUTE_PAIRS.map(pair => {
      const name = `${pair[0]}-${pair[1]}`;
      const distanceKm = Math.round(turf.distance(turf.point(AIRPORTS[pair[0]]), turf.point(AIRPORTS[pair[1]]), { units: 'kilometers' }));
      return turf.greatCircle(AIRPORTS[pair[0]], AIRPORTS[pair[1]], { properties: { name, distanceKm } });
    })
  }), []);

  const getRouteStyle = (feature) => {
    if (!searchQuery) return { color: '#3b82f6', weight: 2, opacity: 0.3, dashArray: '5, 8' };
    const queryUpper = searchQuery.toUpperCase();
    const isMatch = feature.properties.name.includes(queryUpper) || feature.properties.name.split('-').reverse().join('-').includes(queryUpper);
    return { color: isMatch ? '#f97316' : '#3b82f6', weight: isMatch ? 4 : 2, opacity: isMatch ? 1 : 0.1, dashArray: isMatch ? null : '5, 8' };
  };

  const handleFlightClick = async (flight) => {
    const callsign = flight.callsign?.trim();
    if (!callsign) return;
    if (clientCache[callsign]) { onFlightSelect(clientCache[callsign]); return; }
    const airlineName = AIRLINE_MAP[callsign.substring(0, 3).toUpperCase()] || 'COMMERCIAL FLIGHT';
    onFlightSelect({ callsign, airlineName, loading: true, ...flight });
    try {
      const res = await fetch(`/api/flight-details?ident=${callsign}`);
      const apiData = res.ok ? await res.json() : { error: 'NO DATA' };
      const enrichedData = { ...flight, ...apiData, airlineName, loading: false };
      onFlightSelect(enrichedData);
      setClientCache(prev => ({ ...prev, [callsign]: enrichedData }));
    } catch (err) { onFlightSelect({ ...flight, airlineName, error: 'API ERROR', loading: false }); }
  };

  const getFlightVisuals = (flight) => {
    const isSelected = selectedFlightIcao === flight.icao24;
    if (isSelected) return { radius: 8, pathOptions: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 1, weight: 3 }, status: 'SELECTED' };
    if (flight.captured_at) {
      const ageMinutes = (Date.now() - new Date(flight.captured_at).getTime()) / (1000 * 60);
      if (ageMinutes > 30) return { radius: 5, pathOptions: { color: '#64748b', fillColor: '#64748b', fillOpacity: 0.4, weight: 1, opacity: 0.4 }, status: 'GHOST' };
    }
    return { radius: 5, pathOptions: { color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 1, weight: 1 }, status: 'ACTIVE' };
  };

  return (
    <div className="relative w-full h-full">
      {/* 左上角搜索框 */}
      <div className="absolute top-6 left-6 z-[1000] flex flex-col gap-2">
        <div className="flex bg-slate-900/90 backdrop-blur border border-slate-700 rounded-lg overflow-hidden shadow-2xl transition-all">
          <input 
            type="text" placeholder="SEARCH ROUTE" 
            className="bg-transparent text-white px-4 py-3 text-xs font-bold tracking-widest outline-none w-[220px] uppercase"
            value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* 🚨 右上角时间状态栏 */}
      <div className="absolute top-6 right-6 z-[1000] flex gap-3">
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Last Data Sync</span>
          <span className="text-sky-400 font-mono text-sm font-bold">{lastDataUpdateTime}</span>
        </div>
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Local Time (GMT+8)</span>
          <span className="text-emerald-400 font-mono text-sm font-bold">{formattedCurrentTime}</span>
        </div>
      </div>

      <MapContainer center={[25.0, 55.0]} zoom={4} style={{ height: '100%', width: '100%', background: '#0a0f1c' }} zoomControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <Polygon positions={noFlyZone} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.1, dashArray: '5, 5' }} />
        <GeoJSON key={searchQuery} data={referenceRoutesGeoJSON} style={getRouteStyle} />
        {flights.map((flight) => (
          <CircleMarker
            key={flight.icao24} center={[flight.latitude, flight.longitude]}
            radius={getFlightVisuals(flight).radius} pathOptions={getFlightVisuals(flight).pathOptions}
            eventHandlers={{ click: () => handleFlightClick(flight) }}
          />
        ))}
      </MapContainer>
    </div>
  );
}