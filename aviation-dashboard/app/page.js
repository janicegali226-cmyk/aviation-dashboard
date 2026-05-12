"use client";

import { useState, useEffect } from 'react';
import nextDynamic from 'next/dynamic';
import HubMonitor from '@/components/HubMonitor';
import OilPrices from '@/components/OilPrices'; // 🚨 引入新组件
import CostMatrix from '@/components/CostMatrix';
import CostCalculator from '@/components/CostCalculator';

// 动态加载地图
const LiveMap = nextDynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#121a2f] flex items-center justify-center text-sky-500 font-bold tracking-widest">INITIALIZING SATELLITE MAP...</div>
});

const TABS = [
  { id: 'map', num: '01', label: 'ROUTE MAP' },
  { id: 'hub', num: '02', label: 'HUB MONITOR' },
  { id: 'oil', num: '03', label: 'OIL PRICES' },
  { id: 'heat', num: '04', label: 'COST ESTIMATES' },
  { id: 'calc', num: '05', label: 'COST CALCULATOR' },
];

const formatTime = (isoString) => {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
};

export default function MasterDashboard() {
  const [activeTab, setActiveTab] = useState('map');
  const [liveFlightCount, setLiveFlightCount] = useState(0);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightHistory, setFlightHistory] = useState(null);

  const handleFlightSelect = async (flightFromMap) => {
    if (!flightFromMap) { setSelectedFlight(null); setFlightHistory(null); return; }
    setSelectedFlight({ ...flightFromMap, loading: true });
    setFlightHistory({ loading: true });
    const callsign = (flightFromMap.callsign || flightFromMap.ident || '').trim();
    
    try {
      const [detailsRes, historyRes] = await Promise.all([
        fetch(`/api/flight_details?ident=${callsign}`),
        fetch(`/api/flight_history?ident=${callsign}`)
      ]);
      if (detailsRes.ok) {
        const detailData = await detailsRes.json();
        setSelectedFlight(prev => ({ ...prev, ...(detailData.flights?.[0] || {}), loading: false }));
      } else { setSelectedFlight(prev => ({ ...prev, loading: false, isError: true })); }

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setFlightHistory({ records: historyData.history_records || [], loading: false });
      } else { setFlightHistory({ records: [], loading: false, error: true }); }
    } catch (error) {
      setSelectedFlight(prev => ({ ...prev, loading: false, isError: true }));
      setFlightHistory({ records: [], loading: false, error: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1c] flex flex-col font-sans">
      <nav className="border-b border-slate-800 bg-[#0a0f1c] px-12 pt-8">
        <div className="flex space-x-12 overflow-x-auto">
          {TABS.map((tab) => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`pb-4 flex items-center space-x-3 text-sm font-bold tracking-widest ${activeTab === tab.id ? 'text-orange-500 border-b-2 border-orange-500' : 'text-slate-500 hover:text-slate-300'}`}>
              <span className="opacity-40 font-medium">{tab.num}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="flex-grow p-10 relative max-w-[1800px] mx-auto w-full">
        {/* ROUTE MAP */}
        {activeTab === 'map' && (
          <div className="grid grid-cols-4 gap-6 h-[780px]">
            <div className="col-span-3 rounded-xl border border-slate-800 overflow-hidden relative bg-[#121a2f]">
              <LiveMap onFlightUpdate={setLiveFlightCount} onFlightSelect={handleFlightSelect} selectedFlightIcao={selectedFlight?.icao24} />
            </div>
            <div className="col-span-1 flex flex-col gap-6 overflow-y-auto">
              <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-sky-500"></div>
                <h3 className="text-orange-500 font-bold tracking-widest text-[10px] mb-4 uppercase">Active Aircraft</h3>
                <div className="text-5xl font-black text-sky-400 tracking-tighter">{liveFlightCount}</div>
                <p className="text-slate-500 text-[9px] font-bold">IN MONITORED SECTOR</p>
              </div>
              {/* 此处省略了 Legend 和 Flight Details，请保持你原有的逻辑 */}
            </div>
          </div>
        )}

        {/* 🚨 核心简化：其他 Tab 全部使用独立组件 */}
        {activeTab === 'hub' && <HubMonitor />}
        {activeTab === 'oil' && <OilPrices />} 
        {activeTab === 'heat' && <CostMatrix />}
        {activeTab === 'calc' && <CostCalculator />}
      </main>
    </div>
  );
}