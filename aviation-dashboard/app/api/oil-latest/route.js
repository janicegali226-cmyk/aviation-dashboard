import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: 'ljn200326', 
      database: 'aviation_dashboard',
    });

    // 💥 提取最新两天的数据，用来计算 vs prev close 的涨跌百分比
    const [rows] = await connection.execute(
      'SELECT record_date, wti_price, brent_price, jet_fuel_price FROM oil_price_history ORDER BY record_date DESC LIMIT 2'
    );

    await connection.end();

    if (rows.length > 0) {
      const current = rows[0];
      const prev = rows.length > 1 ? rows[1] : rows[0]; // 如果只有一天数据，作为兜底

      // 辅助函数：计算涨跌幅百分比
      const calcPct = (curr, pr) => pr ? ((curr - pr) / pr * 100).toFixed(2) : 0;

      // 组装成 page.js 所需的三大卡片数组格式
      const cardsData = [
        {
          commodity_name: 'WTI CRUDE',
          current_price: current.wti_price,
          price_change_pct: Number(calcPct(current.wti_price, prev.wti_price))
        },
        {
          commodity_name: 'BRENT CRUDE',
          current_price: current.brent_price,
          price_change_pct: Number(calcPct(current.brent_price, prev.brent_price))
        },
        {
          commodity_name: 'JET FUEL [IATA REF]',
          current_price: current.jet_fuel_price,
          price_change_pct: Number(calcPct(current.jet_fuel_price, prev.jet_fuel_price))
        }
      ];

      return NextResponse.json({
        price: current.jet_fuel_price, // 依然保留这个单值，为了给 Cost Calculator 供电
        date: current.record_date,
        cards: cardsData               // 💥 增加 cards 数组，给 page.js 供电
      });
    } else {
      return NextResponse.json({ error: 'No data found in history' }, { status: 404 });
    }
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch latest oil prices' }, { status: 500 });
  }
}