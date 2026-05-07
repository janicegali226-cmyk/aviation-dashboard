"use client";
import React, { useState, useEffect } from 'react';

// ================= 1. 定义机型系统数据库 (完整录入) =================
const AIRCRAFT_DB = {
  'A320': { name: 'Airbus A320 (twin-jet)', pax: 150, speed: 840, crew: 7, burn: 826 },
  'A321': { name: 'Airbus A321 (twin-jet)', pax: 186, speed: 828, crew: 8, burn: 950 },
  'A321N': { name: 'Airbus A321neo (twin-jet)', pax: 186, speed: 828, crew: 8, burn: 650 },
  'A333': { name: 'Airbus A330-300 (twin-jet)', pax: 335, speed: 860, crew: 11, burn: 1850 },
  'A35K': { name: 'Airbus A350-1000 (twin-jet)', pax: 350, speed: 902, crew: 11, burn: 1850 },
  'A359': { name: 'Airbus A350-900 (twin-jet)', pax: 314, speed: 902, crew: 11, burn: 1900 },
  'A388': { name: 'Airbus A380-800 (quad-jet)', pax: 555, speed: 963, crew: 16, burn: 3900 },
  'B38M': { name: 'Boeing 737 MAX 8 (twin-jet)', pax: 170, speed: 969, crew: 8, burn: 720 },
  'B744': { name: 'Boeing 747-400 (quad-jet)', pax: 416, speed: 907, crew: 13, burn: 3400 },
  'B772': { name: 'Boeing 777-200 (twin-jet)', pax: 305, speed: 905, crew: 11, burn: 2450 },
  'B77W': { name: 'BOEING 777-300ER (twin-jet)', pax: 390, speed: 893, crew: 12, burn: 2400 },
  'B78X': { name: 'BOEING 787-10 Dreamliner (twin-jet)', pax: 230, speed: 913, crew: 9, burn: 1750 },
  'B788': { name: 'Boeing 787-8 (twin-jet)', pax: 230, speed: 913, crew: 9, burn: 1750 },
  'B789': { name: 'Boeing 787-9 Dreamliner (twin-jet)', pax: 230, speed: 907, crew: 9, burn: 1750 }
};

export default function CostCalculator() {
  const [acType, setAcType] = useState('B789'); 
  
  // 初始化为 0，并开启 Loading 状态
  const [fuelPrice, setFuelPrice] = useState(0); 
  const [isSyncingPrice, setIsSyncingPrice] = useState(true);
  
  const [fuelBurn, setFuelBurn] = useState(AIRCRAFT_DB['B789'].burn);
  const [normalDistance, setNormalDistance] = useState(7180);
  const [actualTotalTime, setActualTotalTime] = useState(8.85); 
  const [loadFactor, setLoadFactor] = useState(85);
  const [warRisk, setWarRisk] = useState(4500);
  const [extraStopFee, setExtraStopFee] = useState(0);
  const [delayProb, setDelayProb] = useState(35);

  const [results, setResults] = useState({
    baselineTime: 0,
    extraHours: 0,
    extraFuelCost: 0,
    crewOvertime: 0,
    paxComp: 0,
    totalExtraCost: 0,
    totalPax: 0
  });

  const handleAircraftChange = (e) => {
    const selected = e.target.value;
    setAcType(selected);
    setFuelBurn(AIRCRAFT_DB[selected].burn);
  };

  // 💥 核心联动修改：请求你原有的 /api/oil-latest 接口
  useEffect(() => {
    const fetchLatestFuelPrice = async () => {
      try {
        const res = await fetch('/api/oil-latest');
        const data = await res.json();
        if (data && data.price) {
          setFuelPrice(Number(data.price));
        }
      } catch (error) {
        console.error("Failed to fetch real-time fuel price:", error);
      } finally {
        setIsSyncingPrice(false);
      }
    };
    fetchLatestFuelPrice();
  }, []);

  const calculateCosts = () => {
    // 确保油价已拉取再计算
    if (fuelPrice === 0) return;

    const currentAC = AIRCRAFT_DB[acType];
    const crewHourlyRate = 185; 

    const baselineTime = normalDistance / currentAC.speed; 
    let extraTime = actualTotalTime - baselineTime; 
    if (extraTime < 0) extraTime = 0; 

    const fuelBurnBbl = fuelBurn / 42; 
    const extraFuelCostAmt = extraTime * fuelBurnBbl * fuelPrice;
    
    const crewCostAmt = extraTime * currentAC.crew * crewHourlyRate;
    
    const actualPax = Math.round(currentAC.pax * (loadFactor / 100));
    const delayMins = extraTime * 60;
    let compPerPax = 0;
    if (delayMins >= 180) compPerPax = 250;
    else if (delayMins >= 90) compPerPax = 150;
    
    const paxCompAmt = actualPax * compPerPax * (delayProb / 100);

    const totalExtra = extraFuelCostAmt + crewCostAmt + Number(warRisk) + Number(extraStopFee) + paxCompAmt;

    setResults({
      baselineTime: baselineTime.toFixed(2),
      extraHours: extraTime.toFixed(2),
      extraFuelCost: Math.round(extraFuelCostAmt),
      crewOvertime: Math.round(crewCostAmt),
      paxComp: Math.round(paxCompAmt),
      totalExtraCost: Math.round(totalExtra),
      totalPax: actualPax
    });
  };

  useEffect(() => {
    calculateCosts();
  }, [acType, fuelBurn, normalDistance, actualTotalTime, fuelPrice, loadFactor, warRisk, extraStopFee, delayProb]);

  const formatMoney = (val) => Number(val).toLocaleString('en-US');

  return (
    <div className="bg-[#0b1120] min-h-screen text-slate-300 p-6 font-sans">
      <div className="max-w-7xl mx-auto">
        <div className="border-b border-slate-700/50 pb-4 mb-8 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white tracking-widest uppercase">Flight Diversion Simulator</h2>
          <span className="text-xs text-sky-400 font-bold tracking-widest bg-sky-500/10 px-3 py-1 rounded border border-sky-500/20">
            COST ISOLATION MODE
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* ================= 左侧：参数输入区 ================= */}
          <div className="space-y-6">
            <div>
              <h3 className="text-amber-500 text-xs font-bold tracking-widest mb-4">FLIGHT PARAMETERS</h3>
              
              <div className="space-y-4">
                
                {/* 下拉选择机型 */}
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">AIRCRAFT TYPE (AUTO-MATCHES CREW, SPEED, MAX PAX)</label>
                  <div className="relative">
                    <select 
                      value={acType} 
                      onChange={handleAircraftChange}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white appearance-none focus:border-amber-500 outline-none cursor-pointer"
                    >
                      {Object.entries(AIRCRAFT_DB).map(([key, ac]) => (
                        <option key={key} value={key}>
                          {ac.name} — Speed: {ac.speed} km/h | Max Pax: {ac.pax}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-slate-400">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">FUEL BURN (GAL/HR)</label>
                    <input type="number" value={fuelBurn} onChange={(e) => setFuelBurn(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-amber-400 font-mono focus:border-amber-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">NORMAL DISTANCE (KM)</label>
                    <input type="number" value={normalDistance} onChange={(e) => setNormalDistance(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">ACTUAL TOTAL TIME (HOURS)</label>
                    <input type="number" step="0.1" value={actualTotalTime} onChange={(e) => setActualTotalTime(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                  
                  {/* 系统同步的油价 */}
                  <div className="opacity-80">
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1 flex items-center gap-2">
                      JET FUEL PRICE (USD/BBL) <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-1 py-0.5 rounded text-[8px]">AUTO-SYNCED</span>
                    </label>
                    <div className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-emerald-400 font-mono flex items-center">
                      {isSyncingPrice ? <span className="animate-pulse">SYNCING DB...</span> : `$${fuelPrice}`}
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">LOAD FACTOR (%)</label>
                    <input type="number" value={loadFactor} onChange={(e) => setLoadFactor(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">WAR RISK SURCHARGE (USD)</label>
                    <input type="number" value={warRisk} onChange={(e) => setWarRisk(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">EXTRA TECH STOP FEE (USD)</label>
                    <input type="number" value={extraStopFee} onChange={(e) => setExtraStopFee(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 tracking-wider mb-1">PROBABILITY OF DELAY CLAIM (%)</label>
                    <input type="number" value={delayProb} onChange={(e) => setDelayProb(Number(e.target.value))}
                      className="w-full bg-[#121a2f] border border-slate-700 rounded p-3 text-sm text-white focus:border-amber-500 outline-none" />
                  </div>
                </div>

                <div className="bg-sky-500/10 border border-sky-500/30 p-3 rounded text-xs text-sky-400 flex items-center gap-2 mt-4">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" /></svg>
                  System calculated {results.extraHours}H of extra flight time based on {normalDistance}km standard route (Baseline EST: {results.baselineTime}H).
                </div>
              </div>
            </div>
          </div>

          {/* ================= 右侧：成本拆解区 ================= */}
          <div className="bg-[#121a2f] border border-slate-700/50 rounded-lg p-6 flex flex-col justify-start h-full">
            <div>
              <h3 className="text-amber-500 text-xs font-bold tracking-widest mb-6">EXTRA COST BREAKDOWN</h3>
              
              <div className="space-y-5 text-sm">
                <div className="flex justify-between border-b border-slate-700/50 pb-3">
                  <span className="text-slate-400">Extra Fuel ({results.extraHours}h @ {fuelBurn} gal/h)</span>
                  <span className="text-white font-mono">${formatMoney(results.extraFuelCost)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700/50 pb-3">
                  <span className="text-slate-400">Crew Overtime ({results.extraHours}h x {AIRCRAFT_DB[acType].crew} crew @ $185/hr)</span>
                  <span className="text-white font-mono">${formatMoney(results.crewOvertime)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700/50 pb-3">
                  <span className="text-slate-400">War Risk Insurance surcharge</span>
                  <span className="text-white font-mono">${formatMoney(warRisk)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700/50 pb-3">
                  <span className="text-slate-400">Extra Landing / Tech Stop fees</span>
                  <span className="text-white font-mono">${formatMoney(extraStopFee)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700/50 pb-3">
                  <span className="text-slate-400">Pax Comp ({delayProb}% prob x {results.totalPax} pax)</span>
                  <span className="text-white font-mono">${formatMoney(results.paxComp)}</span>
                </div>
              </div>

              {/* 总成本强调框 */}
              <div className="mt-8 border-2 border-amber-500/40 bg-amber-500/10 rounded-xl p-6 flex flex-col items-center justify-center relative overflow-hidden shadow-[0_0_20px_rgba(245,158,11,0.1)]">
                <div className="text-amber-500 font-bold tracking-widest text-sm mb-2">TOTAL EXTRA OPERATION COST</div>
                <div className="text-amber-400 text-5xl font-mono font-black tracking-tighter">
                  {isSyncingPrice ? 'SYNCING...' : `$${formatMoney(results.totalExtraCost)}`}
                </div>
                <p className="text-slate-400 text-[10px] mt-4 uppercase tracking-widest text-center">
                  Cost isolation analysis generated based on real-time parameters
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}