import { NextResponse } from 'next/server';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ident = searchParams.get('ident');

  if (!ident) return NextResponse.json({ error: 'Missing callsign' }, { status: 400 });

  try {
    const response = await fetch(`http://127.0.0.1:5000/api/history/${ident}`);
    
    // 🌟 核心修改：如果 Python 返回错误，把具体的错误原因打印在终端里！
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Python 接口报错 (状态码 ${response.status}):`, errorText);
      throw new Error(`Python Backend failed: ${errorText}`);
    }
    
    const pythonData = await response.json(); 
    return NextResponse.json(pythonData);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}