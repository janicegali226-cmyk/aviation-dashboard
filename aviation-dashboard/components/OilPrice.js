"use client";

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LineChart, Line, Legend } from 'recharts';

export default function OilPrices() {
  const [oilHistory, setOilHistory] = useState([]);
  const [latestOilPrices, setLatestOilPrices] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  // 数据每日 8 点更新，锁定同步时间
  const lastSyncTime = "08:00:00";

  useEffect(() => {
    // 1. 封装数据获取函数
    const fetchData = () => {
      // 获取历史趋势
      fetch('/api/oil-history?_t=' + Date.now())
        .then(res => res.json())
        .then(data => setOilHistory(data));

      // 获取最新卡片数据
      fetch('/api/oil-latest?_t=' + Date.now())
        .then(res => res.json())
        .then(data => {
          if (data && data.cards) setLatestOilPrices(data.cards);
        });
    };

    fetchData();

    // 2. 定时器：每 3 分钟同步一次数据，每 1 秒更新一次本地时钟
    const fetchInterval = setInterval(fetchData, 3 * 60 * 1000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      clearInterval(fetchInterval);
      clearInterval(clockInterval);
    };
  }, []);

  // 格式化东八区时间
  const formattedCurrentTime = useMemo(() => {
    return currentTime.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  }, [currentTime]);

  // 计算价差数据
  const spreadData = useMemo(() => {
    return oilHistory.map(day => ({
      date: day.date,
      spread: Number((day.brent_price - day.wti_price).toFixed(2))
    }));
  }, [oilHistory]);

  return (
    <div className="flex flex-col gap-6 w-full relative">
      
      {/* 右上角悬浮时间状态栏 */}
      <div className="fixed top-6 right-6 z-[9999] flex gap-3">
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Last Data Sync</span>
          <span className="text-sky-400 font-mono text-sm font-bold">{lastSyncTime}</span>
        </div>
        <div className="flex flex-col items-end bg-slate-900/90 backdrop-blur border border-slate-700 px-4 py-2 rounded-lg shadow-2xl">
          <span className="text-[10px] text-slate-500 font-bold tracking-tighter uppercase">Local Time (GMT+8)</span>
          <span className="text-emerald-400 font-mono text-sm font-bold">{formattedCurrentTime}</span>
        </div>
      </div>

      {/* 模块 1：最新油价卡片 */}
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
      
      {/* 模块 2：30天趋势折线图 */}
      <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-8 shadow-2xl w-full h-[450px] flex flex-col">
        <h3 className="text-orange-500 font-bold tracking-widest text-sm mb-6 uppercase">30-Day Price Trend</h3>
        <div className="flex-grow w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={oilHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(val) => `$${val}`} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
              <Legend verticalAlign="top" height={40} />
              <Line type="monotone" dataKey="wti_price" name="WTI" stroke="#f59e0b" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="brent_price" name="Brent" stroke="#06b6d4" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="jet_fuel_price" name="Jet Fuel" stroke="#a855f7" strokeWidth={3} strokeDasharray="5 5" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 模块 3：价差柱状图 */}
      <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-8 shadow-2xl w-full h-[320px] flex flex-col">
        <h3 className="text-orange-500 font-bold tracking-widest text-sm mb-6 uppercase">Crisis Premium: Brent vs WTI Spread</h3>
        <div className="flex-grow w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={spreadData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: '#1e293b' }} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155' }} />
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