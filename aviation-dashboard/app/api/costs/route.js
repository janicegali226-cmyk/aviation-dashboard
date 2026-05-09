// app/api/costs/route.js
import { NextResponse } from 'next/server';
import mysql from 'mysql2/promise';

// 数据库配置（与你的 cost_database.py 保持一致）
const connection = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false // TiDB 必须要求开启 SSL
  }
});

// 辅助函数：根据百分比计算状态（用于前端颜色显示）
const getStatus = (pct) => {
  if (pct > 20) return "High";
  if (pct > 10) return "Amber";
  if (pct > 5) return "Yellow";
  return "Green";
};

export async function GET() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [rows] = await connection.execute(
      "SELECT airline, route, ident, aircraft, fluctuation_pct, extra_fuel, extra_crew, war_risk, extra_stop, delay_comp FROM cost_matrix_data"
    );

    const routeMap = {};
    // ✨ 新增统计变量
    let maxSurge = { ident: 'N/A', increase: -999 };
    const routeStats = {}; 

    rows.forEach((row) => {
      const { route, ident, fluctuation_pct, airline, aircraft, extra_fuel, extra_crew, war_risk, extra_stop, delay_comp } = row;

      // 1. 寻找全场涨幅最高的航班 (MAX COST SURGE)
      if (fluctuation_pct > maxSurge.increase) {
        maxSurge = { ident: ident, increase: fluctuation_pct };
      }

      // 2. 累计各航线数据用于计算平均涨幅 (CRITICAL ROUTE)
      if (!routeStats[route]) {
        routeStats[route] = { total: 0, count: 0 };
      }
      routeStats[route].total += fluctuation_pct;
      routeStats[route].count += 1;

      // 原有的聚合逻辑保持不变...
      if (!routeMap[route]) {
        routeMap[route] = { route, airlines: [] };
      }
      routeMap[route].airlines.push({
        name: airline,
        ident: ident,
        aircraft: aircraft,
        increase: parseFloat(fluctuation_pct.toFixed(1)),
        status: fluctuation_pct > 50 ? 'critical' : (fluctuation_pct > 0 ? 'warning' : 'stable'),
        breakdown: { fuel: extra_fuel, crew: extra_crew, war: war_risk, stop: extra_stop, delay: delay_comp }
      });
    });

    // 3. 计算平均涨幅最高的航线
    let criticalRoute = { name: 'N/A', avgIncrease: -999 };
    Object.keys(routeStats).forEach(name => {
      const avg = routeStats[name].total / routeStats[name].count;
      if (avg > criticalRoute.avgIncrease) {
        criticalRoute = { name: name, avgIncrease: parseFloat(avg.toFixed(1)) };
      }
    });

    // ✨ 返回格式改变：包含 stats 和 data
    return Response.json({
      stats: {
        maxSurge,
        criticalRoute
      },
      data: Object.values(routeMap)
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  } finally {
    await connection.end();
  }
}