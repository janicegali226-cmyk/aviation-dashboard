"use client";
import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function CostMatrix() {
  const [routesData, setRoutesData] = useState([]);
  const [stats, setStats] = useState({
    maxSurge: { ident: '--', increase: 0 },
    criticalRoute: { name: '--', avgIncrease: 0 }
  });

  // ================= Stress Test Module: State Management =================
  const [simOilPrice, setSimOilPrice] = useState(159); // Default oil price
  const [selectedRoute, setSelectedRoute] = useState('');
  const [selectedFlight, setSelectedFlight] = useState('');

  // 🚨 1. Added: Time state management
  const [currentTime, setCurrentTime] = useState(new Date());

  // Core logic: Calculate dynamic sync date based on 08:00:00 threshold and weekend rules (syncs with Oil Prices)
  const syncStatus = useMemo(() => {
    const etNow = new Date(currentTime.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
    const day = etNow.getDay(); // 0: Sunday, 1: Monday, ..., 6: Saturday
    const hour = etNow.getHours();
    
    let targetDate = new Date(etNow);
    
    if (day === 0) { // Sunday -> fallback to Friday
      targetDate.setDate(etNow.getDate() - 2);
    } else if (day === 6) { // Saturday -> fallback to Friday
      targetDate.setDate(etNow.getDate() - 1);
    } else if (day === 1 && hour < 8) { // Monday before 8 AM -> fallback to last Friday
      targetDate.setDate(etNow.getDate() - 3);
    } else if (hour < 8) { // Weekday before 8 AM -> fallback to yesterday
      targetDate.setDate(etNow.getDate() - 1);
    }
    
    return {
      date: targetDate.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
      time: "08:00:00"
    };
  }, [currentTime]);

  // Initialize data fetch and start clock
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/costs');
        const json = await res.json();
        const data = json.data || [];
        setRoutesData(data);
        setStats(json.stats || {
          maxSurge: { ident: '--', increase: 0 },
          criticalRoute: { name: '--', avgIncrease: 0 }
        });

        // Default to selecting the first route and its first flight
        if (data.length > 0) {
          setSelectedRoute(data[0].route);
          if (data[0].airlines.length > 0) {
            setSelectedFlight(data[0].airlines[0].ident);
          }
        }
      } catch (err) {
        console.error("Fetch error:", err);
      }
    };
    
    fetchData();

    // 🚨 2. Added: Update local clock every second
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // 🚨 3. Added: Format current UTC+8 time
  const formattedDateTime = useMemo(() => {
    return {
      date: currentTime.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
      time: currentTime.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    };
  }, [currentTime]);

  // Linked selection logic: automatically switch to the first flight of the route when switching routes
  const handleRouteSelect = (routeStr) => {
    setSelectedRoute(routeStr);
    const routeObj = routesData.find(r => r.route === routeStr);
    if (routeObj && routeObj.airlines.length > 0) {
      setSelectedFlight(routeObj.airlines[0].ident);
    } else {
      setSelectedFlight('');
    }
  };

  // ================= Core: Port backend business logic to frontend simulator =================
  const computeSimCost = (routeStr, aircraft, current_oil_price) => {
    const normalizedRoute = routeStr.replace(/\s+/g, '').toUpperCase();

    // 1. Simulate database distance mapping (km)
    const distMap = {
      'SIN-DXB': 5840, 'LHR-DXB': 5470, 'BKK-DXB': 4880, 'HKG-DXB': 5940,
      'DOH-SIN': 6200, 'SIN-LHR': 10880, 'LHR-SIN': 10880, 'FRA-DXB': 4840,
      'MEL-DXB': 11600, 'BOM-DXB': 1930
    };
    const distance = distMap[routeStr] || 6000;

    // 2. Match performance parameters based on aircraft type (fuzzy matching)
    let speed = 900, fuel_burn_gal = 2500, crew_size = 12, max_pax = 300;
    if (aircraft) {
      const acUpper = aircraft.toUpperCase();
      if (acUpper.includes('A380')) { speed = 963; fuel_burn_gal = 3900; crew_size = 16; max_pax = 555; }
      else if (acUpper.includes('777')) { speed = 893; fuel_burn_gal = 2400; crew_size = 12; max_pax = 390; }
      else if (acUpper.includes('A350')) { speed = 901; fuel_burn_gal = 1900; crew_size = 11; max_pax = 314; }
      else if (acUpper.includes('787')) { speed = 913; fuel_burn_gal = 1750; crew_size = 9; max_pax = 230; }
    }

    const fuel_burn_bbl = fuel_burn_gal / 42;
    const baseline_oil_price = 115;
    const taxi_time_constant = 0.5;
    const crew_hourly_wage = 100;

    // --- A. Calculate pre-war cost ---
    const baseline_air_time = speed > 0 ? distance / speed : 0;
    const baseline_block_time = baseline_air_time + taxi_time_constant;
    
    const baseline_fuel_cost = baseline_air_time * fuel_burn_bbl * baseline_oil_price;
    const baseline_crew_cost = baseline_block_time * crew_size * crew_hourly_wage;
    const baseline_cost = baseline_fuel_cost + baseline_crew_cost;

    // --- B. Calculate current cost ---
    // Refined geographical detour factors
    const delayFactorMap = {
      'FRA-DXB': 1.18, 'LHR-DXB': 1.16, 'HKG-DXB': 1.12, 
      'BKK-DXB': 1.10, 'SIN-DXB': 1.09, 'DOH-SIN': 1.09, 
      'MEL-DXB': 1.04, 'BOM-DXB': 1.01, 'SIN-LHR': 1.02
    };
    const delay_factor = delayFactorMap[routeStr] || 1.02;
    const actual_air_time = baseline_air_time * delay_factor;
    const actual_block_time = actual_air_time + taxi_time_constant;
    
    // Delay compensation calculation
    const delay_mins = (actual_air_time - baseline_air_time) * 60;
    let delay_comp = 0;
    if (delay_mins >= 180) delay_comp = 250 * max_pax;
    else if (delay_mins >= 90) delay_comp = 150 * max_pax;

    // Surcharge determination
    const war_risk = (routeStr.includes('DXB') || routeStr.includes('DOH')) ? 5000 : 0;
    const extra_stop = (distance > 8000 && (routeStr.includes('DXB') || routeStr.includes('DOH'))) ? 1000 : 0;

    // Fuel cost & Crew pay
    const current_fuel_cost = actual_air_time * fuel_burn_bbl * current_oil_price;
    const current_crew_cost = actual_block_time * crew_size * crew_hourly_wage;

    // Extra fuel cost & Extra crew pay
    const extra_fuel = current_fuel_cost - baseline_fuel_cost;
    const extra_crew = current_crew_cost - baseline_crew_cost;

    // Calculate the percentage of extra fuel cost against baseline fuel cost
    let extra_fuel_pct = 0;
    if (baseline_fuel_cost > 0) {
      extra_fuel_pct = (extra_fuel / baseline_fuel_cost) * 100;
    }

    const current_cost = current_fuel_cost + current_crew_cost + delay_comp + war_risk + extra_stop; 

    // --- C. Calculate overall fluctuation percentage ---
    let fluctuation_pct = 0.0;
    if (baseline_cost > 0) {
      fluctuation_pct = ((current_cost - baseline_cost) / baseline_cost) * 100;
    }

    return { 
      extra_fuel: Math.round(extra_fuel), 
      extra_fuel_pct: parseFloat(extra_fuel_pct.toFixed(1)), 
      fluctuation_pct: parseFloat(fluctuation_pct.toFixed(1)), 
      baseline_cost: Math.round(baseline_cost), 
      current_cost: Math.round(current_cost) 
    };
  };

  // ================= 💥 Core modification: Generate left BarChart data =================
  const simChartData = routesData.map(routeObj => {
    const airlines = routeObj.airlines || [];
    let totalExtraFuelPct = 0;
    let validFlightCount = 0;

    if (airlines.length > 0) {
      airlines.forEach(flight => {
        const simResult = computeSimCost(routeObj.route, flight.aircraft, simOilPrice);
        totalExtraFuelPct += simResult.extra_fuel_pct;
        validFlightCount++;
      });
    }

    const avgExtraFuelPct = validFlightCount > 0 
      ? parseFloat((totalExtraFuelPct / validFlightCount).toFixed(1)) 
      : 0;

    return {
      name: routeObj.route,
      'Extra Fuel (%)': avgExtraFuelPct 
    };
  });

  let flightSimData = { extra_fuel: 0, extra_fuel_pct: 0, fluctuation_pct: 0, baseline_cost: 0, current_cost: 0 };
  const currentRouteObj = routesData.find(r => r.route === selectedRoute);
  if (currentRouteObj && selectedFlight) {
    const flightObj = currentRouteObj.airlines.find(a => a.ident === selectedFlight);
    if (flightObj) {
      flightSimData = computeSimCost(selectedRoute, flightObj.aircraft, simOilPrice);
    }
  }

  const getStatusColor = (increase) => {
    if (increase >= 50) return 'text-rose-400 bg-rose-400/10 border-rose-400/20'; 
    if (increase >= 0) return 'text-amber-400 bg-amber-400/10 border-amber-400/20';  
    return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'; 
  };

  const formatPct = (val) => Number(val).toFixed(1);
  const formatMoney = (val) => Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!Array.isArray(routesData) || routesData.length === 0) {
    return <div className="text-slate-400 p-4 flex items-center justify-center min-h-[400px]">Loading route data...</div>;
  }

  return (
    <div className="p-6 relative w-full">
      
      {/* 🚨 4. Added: Global top-right time status floating window (Fixed positioning to stay on top) */}
      <div className="fixed top-6 right-6 z-[9999] flex gap-3">
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Last Data Sync</span>
          <span className="text-slate-400 font-mono text-[10px] leading-none mb-1">{syncStatus.date}</span>
          <span className="text-sky-400 font-mono text-sm font-bold leading-none">{syncStatus.time}</span>
        </div>
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Local Time (GMT+8)</span>
          <span className="text-slate-400 font-mono text-[10px] leading-none mb-1">{formattedDateTime.date}</span>
          <span className="text-emerald-400 font-mono text-sm font-bold leading-none">{formattedDateTime.time}</span>
        </div>
      </div>

      {/* 1. Top real statistics cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6"> 
        <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Max Cost Surge</p>
              <h3 className="text-2xl font-bold text-rose-400 mt-1">{stats.maxSurge.ident}</h3>
            </div>
            <div className="px-2 py-1 bg-rose-400/10 border border-rose-400/20 rounded text-rose-400 text-xs font-bold">
              {stats.maxSurge.increase > 0 ? '+' : ''}{formatPct(stats.maxSurge.increase)}%
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Highest individual flight cost increase detected</p>
        </div>

        <div className="bg-slate-800/50 border border-slate-700/50 p-4 rounded-xl">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Critical Route</p>
              <h3 className="text-2xl font-bold text-amber-400 mt-1">{stats.criticalRoute.name}</h3>
            </div>
            <div className="px-2 py-1 bg-amber-400/10 border border-amber-400/20 rounded text-amber-400 text-xs font-bold">
              Avg {stats.criticalRoute.avgIncrease > 0 ? '+' : ''}{formatPct(stats.criticalRoute.avgIncrease)}%
            </div>
          </div>
          <p className="text-[10px] text-slate-500 mt-2">Route with the highest average fluctuation</p>
        </div>
      </div>

      {/* ================= 2. Stress Test Module (Cost Sensitivity Simulator) ================= */}
      <div className="bg-slate-800/50 border border-slate-700/50 p-6 rounded-xl mb-6 shadow-lg">
        <h3 className="text-lg font-bold text-white tracking-widest mb-4">COST SENSITIVITY STRESS-TEST</h3>
        
        {/* Control panel area */}
        <div className="flex flex-col md:flex-row gap-6 mb-6 bg-slate-900/50 p-4 rounded-lg border border-slate-700/30">
          
          {/* Slider */}
          <div className="flex-1 flex flex-col justify-center">
            <label className="text-xs font-bold text-sky-400 block mb-3">ADJUST JET FUEL PRICE ($/BBL)</label>
            <div className="flex items-center gap-4">
              <input 
                type="range" min="80" max="250" step="1" 
                value={simOilPrice} 
                onChange={(e) => setSimOilPrice(Number(e.target.value))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-400"
              />
              <span className="text-2xl font-black text-sky-400 w-20 text-right">${simOilPrice}</span>
            </div>
          </div>
          
          {/* Route and flight selection boxes */}
          <div className="flex-1 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-2">SELECT ROUTE</label>
              <select 
                className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white text-sm outline-none focus:border-sky-400"
                value={selectedRoute} 
                onChange={(e) => handleRouteSelect(e.target.value)}
              >
                {routesData.map(r => <option key={r.route} value={r.route}>{r.route}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs text-slate-400 block mb-2">SELECT FLIGHT</label>
              <select 
                className="w-full bg-slate-800 border border-slate-600 rounded-lg p-2.5 text-white text-sm outline-none focus:border-sky-400"
                value={selectedFlight} 
                onChange={(e) => setSelectedFlight(e.target.value)}
              >
                {currentRouteObj?.airlines.map(f => (
                  <option key={f.ident} value={f.ident}>{f.ident} ({f.aircraft.split(' ')[0]})</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Chart and data panel display area */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left: Horizontal comparison bar chart of Extra Fuel % for 8 routes */}
          <div className="lg:col-span-2 bg-slate-900/30 p-4 rounded-lg border border-slate-700/30">
            <h4 className="text-sm font-bold text-slate-300 mb-4 tracking-wider">Extra Fuel % vs Baseline (Route Average)</h4>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={simChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} />
                  <Tooltip 
                    cursor={{fill: '#1e293b', opacity: 0.4}}
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', color: '#fff' }}
                    formatter={(value) => `${formatPct(value)}%`}
                  />
                  <Bar dataKey="Extra Fuel (%)" fill="#38bdf8" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Calculation panel for the specifically selected flight */}
          <div className="bg-slate-900/30 p-5 rounded-lg border border-slate-700/30 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-5">
              <h4 className="text-sm font-bold text-slate-300 tracking-wider">Flight Projection</h4>
              <span className="text-xs font-bold text-sky-400 px-2 py-0.5 bg-sky-400/10 rounded border border-sky-400/20">{selectedFlight}</span>
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <span className="text-slate-400 text-sm">Baseline Cost (Pre-War)</span>
                <span className="text-white font-medium">${formatMoney(flightSimData.baseline_cost)}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <span className="text-slate-400 text-sm">Projected Total Cost</span>
                <span className="text-rose-400 font-bold">${formatMoney(flightSimData.current_cost)}</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-700 pb-3">
                <span className="text-slate-400 text-sm">Fuel Sensitivity (Extra)</span>
                <span className="text-sky-400 font-bold">
                  +{formatPct(flightSimData.extra_fuel_pct)}% (${formatMoney(flightSimData.extra_fuel)})
                </span>
              </div>
              <div className="flex justify-between items-center bg-slate-800/80 p-3 rounded-lg border border-slate-600/50 mt-2">
                <span className="text-slate-300 font-bold text-sm uppercase">Total Fluctuation</span>
                <span className={`text-xl font-black ${flightSimData.fluctuation_pct > 0 ? 'text-rose-500' : 'text-emerald-400'}`}>
                  {flightSimData.fluctuation_pct > 0 ? '+' : ''}{formatPct(flightSimData.fluctuation_pct)}%
                </span>
              </div>
            </div>
          </div>

        </div>
      </div>


      {/* 3. Core card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        {routesData.map((routeInfo, idx) => {
          const airlines = routeInfo.airlines || [];
          const avgIncreaseNum = airlines.length > 0 ? (airlines.reduce((sum, a) => sum + a.increase, 0) / airlines.length) : 0;

          return (
            <div key={idx} className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden hover:border-slate-600 transition-colors shadow-lg">
              <div className="p-5 border-b border-slate-700/50 flex justify-between items-center">
                <h3 className="text-lg font-bold text-white tracking-widest">{routeInfo.route}</h3>
                <div className={`px-3 py-1 rounded-full border text-sm font-bold ${getStatusColor(avgIncreaseNum)}`}>
                  {avgIncreaseNum > 0 ? '+' : ''}{formatPct(avgIncreaseNum)}% (Avg)
                </div>
              </div>

              <div className="p-0">
                <ul className="divide-y divide-slate-700/30">
                  {airlines.map((airline, aIdx) => (
                    <details key={aIdx} className="group">
                      <summary className="p-4 flex justify-between items-center cursor-pointer list-none">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-200">{airline.name}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-bold text-sky-400 px-2 py-0.5 bg-sky-400/10 rounded border border-sky-400/20 w-fit">
                              {airline.ident}
                            </span>
                            <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-800 rounded border border-slate-700 w-fit">
                              {airline.aircraft}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className={`text-base font-bold ${getStatusColor(airline.increase).split(' ')[0]}`}>
                            {airline.increase > 0 ? '+' : ''}{formatPct(airline.increase)}%
                          </div>
                          <svg className="w-4 h-4 text-slate-500 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </summary>
                      
                      <div className="px-4 pb-4 pt-1 border-t border-slate-700/30 bg-slate-800/30 text-xs">
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                          <div className="flex justify-between">
                            <span className="text-slate-400">Extra Fuel:</span>
                            <span className={airline.breakdown.fuel > 0 ? "text-orange-400" : "text-emerald-400"}>
                              ${formatMoney(airline.breakdown.fuel)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Crew Overtime:</span>
                            <span className={airline.breakdown.crew > 0 ? "text-orange-400" : "text-emerald-400"}>
                              ${formatMoney(airline.breakdown.crew)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">War Risk:</span>
                            <span className="text-red-400 font-medium">${formatMoney(airline.breakdown.war)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-400">Extra Stop:</span>
                            <span className="text-red-400 font-medium">${formatMoney(airline.breakdown.stop)}</span>
                          </div>
                          <div className="flex justify-between col-span-2 border-t border-slate-700/50 pt-1 mt-1">
                            <span className="text-slate-400">Delay Comp (Pax):</span>
                            <span className="text-yellow-400">${formatMoney(airline.breakdown.delay)}</span>
                          </div>
                        </div>
                      </div>
                    </details>
                  ))}
                  {airlines.length === 0 && (
                    <li className="p-4 text-center text-sm text-slate-500 italic">No direct flights available</li>
                  )}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}