import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// 1. 将配置项提取到外面
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

    // 提取数据并按日期升序排列（画折线图必须是从早到晚）
    const [rows] = await connection.execute(
      'SELECT DATE_FORMAT(record_date, "%b %d") as date, wti_price, brent_price, jet_fuel_price FROM oil_price_history ORDER BY record_date ASC'
    );

    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch oil history' }, { status: 500 });
  } finally {
    // 3. 🚨 核心保命机制：无论代码是否报错，强制执行关闭连接
    if (connection) {
      await connection.end();
    }
  }
}