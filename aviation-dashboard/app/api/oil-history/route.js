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

    // 提取数据并按日期升序排列（画折线图必须是从早到晚）
    const [rows] = await connection.execute(
      'SELECT DATE_FORMAT(record_date, "%b %d") as date, wti_price, brent_price, jet_fuel_price FROM oil_price_history ORDER BY record_date ASC'
    );

    await connection.end();
    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库请求失败:', error);
    return NextResponse.json({ error: 'Failed to fetch oil history' }, { status: 500 });
  }
}