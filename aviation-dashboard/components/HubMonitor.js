"use client";

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function HubMonitor() {
  const [hubs, setHubs] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 1. 实时时钟状态（用于右侧本地时间跳动）
  const [currentTime, setCurrentTime] = useState(new Date());

  // 2. 🚨 核心修改：固定数据更新时间为每日 08:00:00
  const lastSyncTime = "08:00:00";

  useEffect(() => {
    // 封装获取数据的函数，并加上防缓存时间戳
    const fetchHubs = () => {
      fetch(`/api/hubs?_t=${Date.now()}`, { cache: 'no-store' })
        .then((res) => res.json())
        .then((data) => {
          setHubs(data);
          setLoading(false);
        })
        .catch(err => console.error("Fetch Hubs Error:", err));
    };

    // 初次加载数据
    fetchHubs();

    // 设置定时器（每 3 分钟刷一次数据，1 秒钟刷一次本地时钟）
    const fetchInterval = setInterval(fetchHubs, 3 * 60 * 1000);
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      clearInterval(fetchInterval);
      clearInterval(clockInterval);
    };
  }, []);

  // 格式化当前东八区时间
  const formattedCurrentTime = useMemo(() => {
    return currentTime.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  }, [currentTime]);

  const getStatusLabel = (hub) => {
    if (hub.total_samples < 50) return { text: "CRITICAL (GHOST TOWN)", color: "text-red-500 border-red-500 bg-red-500/10" };
    if (hub.cancelled_count > 5 || hub.avg_delay_mins > 60) return { text: "CRITICAL", color: "text-red-500 border-red-500 bg-red-500/10" };
    if (hub.total_samples < 100) return { text: "CAUTION (LOW TRAFFIC)", color: "text-yellow-500 border-yellow-500 bg-yellow-500/10" };
    if (hub.cancelled_count > 0 || hub.avg_delay_mins > 15 || hub.delayed_count > 20) return { text: "CAUTION", color: "text-yellow-500 border-yellow-500 bg-yellow-500/10" };
    return { text: "NORMAL", color: "text-green-500 border-green-500 bg-green-500/10" };
  };

  const getCancelBarColor = (count) => {
    if (count > 20) return '#dc2626';
    if (count > 5) return '#d97706';
    return '#16a34a';
  };

  return (
    <div className="relative w-full">
      {/* 右上角时间状态悬浮窗 (Fixed 定位，确保在页面最顶层) */}
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

      {loading ? (
        <div className="h-[600px] flex items-center justify-center text-sky-500 font-bold tracking-widest">LOADING HUB DATA...</div>
      ) : (
        <>
          {/* 模块 1：八大机场核心卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {hubs.map((hub, index) => {
              const status = getStatusLabel(hub);
              return (
                <div key={index} className="bg-[#121a2f] border border-slate-700/50 rounded-xl p-6 shadow-xl relative overflow-hidden">
                  <div className={`absolute top-0 left-0 w-full h-1 ${status.color.split(' ')[0].replace('text', 'bg')}`}></div>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-4xl font-black text-slate-100 tracking-tighter">{hub.airport_code}</h2>
                      <p className="text-slate-500 text-xs font-semibold tracking-widest mt-1">SAMPLE: {hub.total_samples}</p>
                    </div>
                    <div className={`px-2 py-1 text-[10px] font-black tracking-widest border rounded ${status.color}`}>
                      {status.text}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-y-6 gap-x-4 mt-8">
                    <div className="flex flex-col">
                      <span className="text-3xl font-bold text-sky-400">{hub.delayed_count}</span>
                      <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-1">DELAYED</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-3xl font-bold text-slate-100">{hub.cancelled_count}</span>
                      <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-1">CANCELLED</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-3xl font-bold text-slate-400">{hub.diverted_count}</span>
                      <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-1">DIVERTED</span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-3xl font-bold text-yellow-500">{hub.avg_delay_mins}<span className="text-lg text-yellow-500/50 ml-1">m</span></span>
                      <span className="text-slate-500 text-[10px] font-bold tracking-widest mt-1">AVG DELAY</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 模块 2：可视化图表区域 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-xl">
              <h3 className="text-orange-500 font-bold tracking-widest mb-8 text-sm">CANCELLATIONS (SAMPLE BASE)</h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hubs} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="airport_code" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#1e293b' }} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }} />
                    <Bar dataKey="cancelled_count" radius={[4, 4, 0, 0]}>
                      {hubs.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getCancelBarColor(entry.cancelled_count)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-xl">
              <h3 className="text-orange-500 font-bold tracking-widest mb-8 text-sm">AVERAGE DELAY (MINUTES)</h3>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hubs} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="airport_code" stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis stroke="#64748b" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#1e293b' }} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc' }} />
                    <Bar dataKey="avg_delay_mins" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}