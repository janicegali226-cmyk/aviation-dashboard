"use client";

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';

export default function OilPrices() {
  const [oilHistory, setOilHistory] = useState([]);
  const [latestOilPrices, setLatestOilPrices] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Core logic: Calculate dynamic sync date based on 08:00:00 threshold and weekend rules
  const oilSyncStatus = useMemo(() => {
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

  useEffect(() => {
    // 1. Encapsulate data fetching function
    const fetchData = () => {
      // Fetch historical trends
      fetch('/api/oil-history?_t=' + Date.now())
        .then(res => res.json())
        .then(data => setOilHistory(data));

      // Fetch latest card data
      fetch('/api/oil-latest?_t=' + Date.now())
        .then(res => res.json())
        .then(data => {
          if (data && data.cards) setLatestOilPrices(data.cards);
        });
    };

    fetchData();

    // 2. Timers: Sync data every 3 mins, update local clock every 1 sec
    const fetchInterval = setInterval(fetchData, 3 * 60 * 1000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      clearInterval(fetchInterval);
      clearInterval(clockInterval);
    };
  }, []);

  // Format current time in UTC+8
  const formattedCurrentTime = useMemo(() => {
    return {
      date: currentTime.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
      time: currentTime.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
    };
  }, [currentTime]);

  // Calculate price spread data
  const spreadData = useMemo(() => {
    return oilHistory.map(day => ({
      date: day.date,
      spread: Number((day.brent_price - day.wti_price).toFixed(2))
    }));
  }, [oilHistory]);

  return (
    <div className="flex flex-col gap-6 w-full relative">
      
      {/* Top-right floating time status bar */}
      <div className="fixed top-6 right-6 z-[9999] flex gap-3">
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Last Data Sync</span>
          <span className="text-slate-400 font-mono text-[10px] leading-none mb-1">{oilSyncStatus.date}</span>
          <span className="text-sky-400 font-mono text-sm font-bold leading-none">{oilSyncStatus.time}</span>
        </div>
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Local Time (GMT+8)</span>
          <span className="text-slate-400 font-mono text-[10px] leading-none mb-1">{formattedCurrentTime.date}</span>
          <span className="text-emerald-400 font-mono text-sm font-bold leading-none">{formattedCurrentTime.time}</span>
        </div>
      </div>

      {/* Module 1: Latest oil price cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {latestOilPrices.map((item, index) => {
          const isUp = item.price_change_pct > 0;
          let displayName = item.commodity_name.toUpperCase();
          if (displayName.includes('JET')) displayName = 'JET FUEL [IATA REF]';
          
          return (
            <div key={index} className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-2xl relative overflow-hidden group hover:border-slate-600 transition-colors">
              <h4 className="text-slate-500 font-bold tracking-widest text-xs mb-4">{displayName}</h4>
              <div className="text-4xl font-black text-slate-100 tracking-tighter mb-1">${item.current_price}</div>
              <div className="text-slate-500 text-[10px] font-bold tracking-widest mb-6">USD / bbl</div>
              <div className={`text-xs font-bold flex items-center gap-[6px] ${isUp ? 'text-red-500' : 'text-green-500'}`}>
                <span>{isUp ? '▲' : '▼'}</span>
                <span>{Math.abs(item.price_change_pct)}%</span>
                <span className="text-slate-500 font-medium tracking-widest text-[10px] ml-1">vs prev close</span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Module 2: 30-Day trend line chart */}
      <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-8 shadow-2xl w-full h-[450px] flex flex-col">
        <h3 className="text-orange-500 font-bold tracking-widest text-sm mb-6 uppercase">30-Day Price Trend</h3>
        <div className="flex-grow w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={oilHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
              <Tooltip 
                cursor={{ fill: '#1e293b' }} 
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} 
                itemStyle={{ color: '#38bdf8', fontWeight: 'bold' }} 
                labelStyle={{ color: '#cbd5e1', fontWeight: 'bold', borderBottom: '1px solid #334155', paddingBottom: '4px', marginBottom: '8px' }}
              />
              <Legend verticalAlign="top" height={40} />
              <Line type="monotone" dataKey="wti_price" name="WTI" stroke="#f59e0b" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="brent_price" name="Brent" stroke="#06b6d4" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="jet_fuel_price" name="Jet Fuel" stroke="#a855f7" strokeWidth={3} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Module 3: Price spread bar chart */}
      <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-8 shadow-2xl w-full h-[320px] flex flex-col">
        <h3 className="text-orange-500 font-bold tracking-widest text-sm mb-6 uppercase">Crisis Premium: Brent vs WTI Spread</h3>
        <div className="flex-grow w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spreadData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              {/* 🚨 Core fix: Add itemStyle for bright blue, and beautify labelStyle border and font 🚨 */}
              <Tooltip 
                cursor={{ fill: '#1e293b' }} 
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px' }} 
                itemStyle={{ color: '#38bdf8', fontWeight: 'bold' }} 
                labelStyle={{ color: '#cbd5e1', fontWeight: 'bold', borderBottom: '1px solid #334155', paddingBottom: '4px', marginBottom: '8px' }}
              />
              <Bar dataKey="spread" name="Spread" radius={[2, 2, 0, 0]}>
                {spreadData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.spread < 2 || entry.spread > 5 ? '#ef4444' : '#0ea5e9'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}