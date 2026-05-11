import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// 1. 提取配置项，保持代码整洁
const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
    rejectUnauthorized: false // TiDB 必须要求开启 SSL
  }
};

export async function GET() {
  let connection;
  try {
    // 2. 临时建立连接
    connection = await mysql.createConnection(dbConfig);

    // 提取最新两天的数据，用来计算 vs prev close 的涨跌百分比
    const [rows] = await connection.execute(
      'SELECT record_date, wti_price, brent_price, jet_fuel_price FROM oil_price_history ORDER BY record_date DESC LIMIT 2'
    );

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
        price: current.jet_fuel_price, // 保留单值给 Cost Calculator 供电
        date: current.record_date,
        cards: cardsData               // cards 数组给 page.js 供电
      });
    } else {
      return NextResponse.json({ error: 'No data found in history' }, { status: 404 });
    }
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch latest oil prices' }, { status: 500 });
  } finally {
    // 3. 🚨 核心保命机制：无论代码是否报错，强制执行关闭连接！
    if (connection) {
      await connection.end();
    }
  }
}