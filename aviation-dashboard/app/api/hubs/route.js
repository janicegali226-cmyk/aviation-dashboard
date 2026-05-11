import mysql from 'mysql2/promise';
import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

// 1. 将配置项提取出来，保持代码整洁
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

    // 执行查询，获取最新抓取的 8 个机场数据
    const [rows] = await connection.execute(
      'SELECT * FROM hub_status_report ORDER BY check_time DESC LIMIT 8'
    );

    // 把数据打包成 JSON 发给前端网页
    return NextResponse.json(rows);
  } catch (error) {
    console.error('数据库连接报错:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  } finally {
    // 3. 🚨 核心保命机制：无论成功还是报错，必定安全关闭连接
    if (connection) {
      await connection.end();
    }
  }
}