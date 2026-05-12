"use client";

import { useState } from 'react';
import nextDynamic from 'next/dynamic';
import HubMonitor from '@/components/HubMonitor';
import OilPrices from '@/components/OilPrices'; 
import CostMatrix from '@/components/CostMatrix';
import CostCalculator from '@/components/CostCalculator';

// 动态加载地图组件
const LiveMap = nextDynamic(() => import('@/components/LiveMap'), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full bg-[#121a2f] flex items-center justify-center text-sky-500 font-bold tracking-widest border border-slate-800 rounded-xl">
      INITIALIZING SATELLITE MAP...
    </div>
  )
});

const TABS = [
  { id: 'map', num: '01', label: 'ROUTE MAP' },
  { id: 'hub', num: '02', label: 'HUB MONITOR' },
  { id: 'oil', num: '03', label: 'OIL PRICES' },
  { id: 'heat', num: '04', label: 'COST ESTIMATES' },
  { id: 'calc', num: '05', label: 'COST CALCULATOR' },
];

// 辅助函数：格式化时间并标注时区
const formatTime = (isoString) => {
  if (!isoString) return '--:--';
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit', 
    hour12: false,
    timeZoneName: 'short' 
  });
};

export default function MasterDashboard() {
  const [activeTab, setActiveTab] = useState('map');
  const [liveFlightCount, setLiveFlightCount] = useState(0);
  const [selectedFlight, setSelectedFlight] = useState(null);
  const [flightHistory, setFlightHistory] = useState(null);

  // 拦截地图点击，发起 API 查询
  const handleFlightSelect = async (flightFromMap) => {
    if (!flightFromMap) {
      setSelectedFlight(null);
      setFlightHistory(null); 
      return;
    }

    setSelectedFlight({ ...flightFromMap, loading: true });
    setFlightHistory({ loading: true }); 

    const callsign = (flightFromMap.callsign || flightFromMap.ident || '').trim();
    if (!callsign) {
      setSelectedFlight((prev) => ({ ...prev, loading: false }));
      setFlightHistory(null);
      return;
    }

    try {
      const [detailsRes, historyRes] = await Promise.all([
        fetch(`/api/flight-details?ident=${callsign}`), // 统一使用你改好的 flight-details 接口
        fetch(`/api/flight-history?ident=${callsign}`)  // 统一使用你改好的 flight-history 接口
      ]);
      
      if (detailsRes.ok) {
        const detailData = await detailsRes.json();
        const flightDetails = detailData.flights?.[0] || {};
        setSelectedFlight((prev) => ({ ...prev, ...flightDetails, loading: false }));
      } else {
        setSelectedFlight((prev) => ({ ...prev, loading: false, isError: true }));
      }

      if (historyRes.ok) {
        const historyData = await historyRes.json();
        setFlightHistory({ 
          records: historyData.history_records || [], 
          loading: false 
        });
      } else {
        setFlightHistory({ records: [], loading: false, error: true });
      }

    } catch (error) {
      console.error("API Query Error:", error);
      setSelectedFlight((prev) => ({ ...prev, loading: false, isError: true }));
      setFlightHistory({ records: [], loading: false, error: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1c] flex flex-col font-sans selection:bg-sky-500/30">
      
      {/* 顶部导航栏 */}
      <nav className="border-b border-slate-800 bg-[#0a0f1c] px-6 md:px-12 pt-8">
        <div className="flex space-x-12 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-4 flex items-center space-x-3 text-sm font-bold tracking-widest whitespace-nowrap transition-colors duration-200 ${
                activeTab === tab.id
                  ? 'text-orange-500 border-b-2 border-orange-500' 
                  : 'text-slate-500 hover:text-slate-300'          
              }`}
            >
              <span className={`${activeTab === tab.id ? 'opacity-70' : 'opacity-40'} font-medium`}>{tab.num}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* 下方内容展示区 */}
      <main className="flex-grow p-6 md:p-10 relative max-w-[1800px] mx-auto w-full">
        
        {/* ROUTE MAP 板块 */}
        {activeTab === 'map' && (
          <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[780px]">
            <div className="lg:col-span-3 rounded-xl border border-slate-800 overflow-hidden shadow-2xl relative bg-[#121a2f]">
              <LiveMap 
                onFlightUpdate={setLiveFlightCount} 
                onFlightSelect={handleFlightSelect}
                selectedFlightIcao={selectedFlight?.icao24}
              />
            </div>

            <div className="lg:col-span-1 flex flex-col gap-6 overflow-y-auto pr-2 custom-scrollbar">
              <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-xl relative overflow-hidden shrink-0">
                <div className="absolute top-0 left-0 w-full h-1 bg-sky-500 shadow-[0_0_10px_#0ea5e9]"></div>
                <h3 className="text-orange-500 font-bold tracking-widest text-[10px] mb-4 uppercase">Active Aircraft</h3>
                <div className="text-5xl font-black text-sky-400 tracking-tighter mb-1">{liveFlightCount}</div>
                <p className="text-slate-500 text-[9px] font-bold tracking-widest uppercase">IN MONITORED SECTOR</p>
              </div>

              <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-xl shrink-0">
                <h3 className="text-orange-500 font-bold tracking-widest text-[10px] mb-6 uppercase">Map Legend</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-[#06b6d4] shadow-[0_0_8px_#06b6d4]"></div>
                    <span className="text-slate-300 text-[10px] font-bold tracking-widest uppercase">Live Aircraft</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-[2px] bg-[#3b82f6] opacity-30"></div>
                    <span className="text-slate-300 text-[10px] font-bold tracking-widest uppercase">Reference Route</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border border-red-500 bg-red-500/20 rounded"></div>
                    <span className="text-slate-300 text-[10px] font-bold tracking-widest uppercase">Restricted FIR</span>
                  </div>
                </div>
              </div>

              <div className="bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-xl flex-grow flex flex-col min-h-[350px]">
                <div className="flex justify-between items-center border-b border-slate-700/50 pb-3 mb-4">
                  <span className="text-orange-500 text-[10px] font-bold tracking-widest uppercase">Flight Details</span>
                  {selectedFlight && <button onClick={() => setSelectedFlight(null)} className="text-slate-500 hover:text-white">✕</button>}
                </div>

                {!selectedFlight ? (
                  <div className="flex-grow flex flex-col items-center justify-center text-center px-4">
                    <div className="w-12 h-12 border border-dashed border-slate-700 rounded-full mb-4 flex items-center justify-center">
                      <div className="w-1.5 h-1.5 bg-slate-600 rounded-full animate-ping"></div>
                    </div>
                    <p className="text-slate-600 text-[9px] font-bold tracking-widest uppercase leading-loose">
                      Select an aircraft point<br/>on the map to sync<br/>live telemetry
                    </p>
                  </div>
                ) : selectedFlight.loading ? (
                  <div className="flex-grow flex flex-col items-center justify-center gap-4">
                    <div className="w-6 h-6 border-2 border-sky-500/20 border-t-sky-500 rounded-full animate-spin"></div>
                    <span className="text-sky-500 text-[10px] font-bold tracking-widest uppercase">SYNCING DATA...</span>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-lg font-black text-white leading-tight mb-2 uppercase">{selectedFlight.airlineName}</h4>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-sky-500/20 text-sky-400 border border-sky-500/50 rounded text-[9px] font-bold tracking-widest uppercase">
                          {selectedFlight.ident || selectedFlight.callsign}
                        </span>
                        <span className="text-slate-400 text-[9px] font-bold tracking-widest uppercase">
                          {selectedFlight.aircraft_type || 'B789'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 items-center gap-2 py-5 border-y border-slate-800/50">
                      <div className="text-center">
                        <div className="text-2xl font-black text-slate-200">
                          {selectedFlight.origin_airport || selectedFlight.origin?.code || '---'}
                        </div>
                        <div className="text-emerald-400 font-mono text-[10px] font-bold mt-2">
                          {formatTime(selectedFlight.actual_out || selectedFlight.scheduled_out)}
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center px-2 relative h-full">
                        <div className="absolute -top-4 flex flex-col items-center w-full">
                          <span className="text-[9px] text-sky-400 font-bold tracking-widest bg-[#121a2f] px-2">
                            {selectedFlight.filed_ete 
                              ? `${Math.floor(selectedFlight.filed_ete / 3600)}H ${Math.floor((selectedFlight.filed_ete % 3600) / 60)}M` 
                              : 'ETE N/A'}
                          </span>
                          <span className="text-[8px] text-slate-500 font-bold tracking-widest mt-0.5 bg-[#121a2f] px-2">
                            {selectedFlight.route_distance 
                              ? `${Math.round(selectedFlight.route_distance * 1.60934)} KM` 
                              : 'DIST N/A'}
                          </span>
                        </div>
                        <div className="w-full h-[1px] bg-slate-700 relative mt-2">
                          <div className="absolute right-0 -top-1 border-l-4 border-l-sky-500 border-y-4 border-y-transparent"></div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-2xl font-black text-slate-200">
                          {selectedFlight.destination_airport || selectedFlight.destination?.code || '---'}
                        </div>
                        <div className="text-orange-400 font-mono text-[10px] font-bold mt-2">
                          {formatTime(selectedFlight.estimated_in || selectedFlight.scheduled_in)}
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-900/50 rounded-lg p-4 text-center">
                      <span className="text-[9px] text-slate-500 font-bold tracking-widest uppercase block mb-1">Current Ground Speed</span>
                      <span className="text-2xl font-black text-sky-400">
                        {Math.round((selectedFlight.velocity || 0) * 3.6)} 
                        <span className="text-[10px] text-slate-600 font-bold ml-1 uppercase">KM/H</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {(flightHistory && selectedFlight) && (
            <div className="mt-6 bg-[#121a2f] border border-slate-800 rounded-xl p-6 shadow-2xl">
              <h3 className="text-orange-500 font-bold tracking-widest text-xs mb-4 uppercase">
                Recent Flight History — {selectedFlight.ident || selectedFlight.callsign}
              </h3>
              
              {flightHistory.loading ? (
                <div className="h-32 flex items-center justify-center text-sky-500 text-xs font-bold tracking-widest animate-pulse uppercase">
                  FETCHING ARCHIVE DATA...
                </div>
              ) : flightHistory.records?.length > 0 ? (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-700/50">
                        {['Date', 'Aircraft', 'Origin', 'Destination', 'Departure', 'Arrival', 'Duration'].map((head) => (
                          <th key={head} className="pb-3 pr-4 text-slate-500 font-bold tracking-widest text-[10px] uppercase">
                            {head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-sm font-medium text-slate-300">
                      {flightHistory.records.map((row, idx) => (
                        <tr key={idx} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                          <td className="py-3 pr-4 whitespace-nowrap">{row.Date}</td>
                          <td className="py-3 pr-4 text-sky-400">{row.Aircraft}</td>
                          <td className="py-3 pr-4 font-black">{row.Origin}</td>
                          <td className="py-3 pr-4 font-black">{row.Destination}</td>
                          <td className="py-3 pr-4 font-mono text-emerald-400">{row.Departure}</td>
                          <td className="py-3 pr-4 font-mono text-orange-400">{row.Arrival}</td>
                          <td className="py-3 pr-4 text-slate-400">{row.Duration}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="h-32 flex items-center justify-center text-slate-600 text-xs font-bold tracking-widest uppercase">
                  No historical data available for this callsign.
                </div>
              )}
            </div>
          )}
          </>
        )}

        {/* 其他独立组件渲染区 */}
        {activeTab === 'hub' && <HubMonitor />}
        {activeTab === 'oil' && <OilPrices />} 
        {activeTab === 'heat' && <CostMatrix />}
        {activeTab === 'calc' && <CostCalculator />}

      </main>
    </div>
  );
}