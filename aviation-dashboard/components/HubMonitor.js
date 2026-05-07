"use client";

import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function HubMonitor() {
  const [hubs, setHubs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/hubs')
      .then((res) => res.json())
      .then((data) => {
        setHubs(data);
        setLoading(false);
      });
  }, []);

  const getStatusLabel = (hub) => {
    // 1. 新增你的高阶逻辑：流量枯竭/幽灵机场判定 (样本量极低)
    if (hub.total_samples < 50) {
      return { text: "CRITICAL (GHOST TOWN)", color: "text-red-500 border-red-500 bg-red-500/10" };
    }

    // 2. 原有的取消与延误严重判定
    if (hub.cancelled_count > 5 || hub.avg_delay_mins > 60) {
      return { text: "CRITICAL", color: "text-red-500 border-red-500 bg-red-500/10" };
    }

    // 3. 流量衰减警告 (样本量不满 100)
    if (hub.total_samples < 100) {
      return { text: "CAUTION (LOW TRAFFIC)", color: "text-yellow-500 border-yellow-500 bg-yellow-500/10" };
    }

    // 4. 原有的轻度取消与延误警告
    if (hub.cancelled_count > 0 || hub.avg_delay_mins > 15 || hub.delayed_count > 20) {
      return { text: "CAUTION", color: "text-yellow-500 border-yellow-500 bg-yellow-500/10" };
    }

    // 5. 一切正常
    return { text: "NORMAL", color: "text-green-500 border-green-500 bg-green-500/10" };
  };

  const getCancelBarColor = (count) => {
    if (count > 20) return '#dc2626';
    if (count > 5) return '#d97706';
    return '#16a34a';
  };

  if (loading) {
    return <div className="h-[600px] flex items-center justify-center text-sky-500 font-bold tracking-widest">LOADING HUB DATA...</div>;
  }

  return (
    <div className="w-full">
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
    </div>
  );
}