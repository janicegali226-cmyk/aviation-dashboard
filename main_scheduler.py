import time
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler

# 导入你现有的各个抓取模块
# 注意：前提是这些文件在同一个目录下
import opensky
import oilprice
import airport_data

# ==========================================
# 1. 定义调度任务包装器
# ==========================================
def job_opensky():
    print(f"\n[{datetime.now()}] 🛫 开始执行：每 3 小时一次的航班位置抓取 (OpenSky)...")
    try:
        # opensky.py 里的数据调用函数
        opensky.fetch_and_store_flights() 
        print(f"[{datetime.now()}] ✅ OpenSky 抓取完成！")
    except Exception as e:
        print(f"[{datetime.now()}] ❌ OpenSky 抓取失败: {e}")

def job_oilprice():
    print(f"\n[{datetime.now()}] 🛢️ 开始执行：每日开盘油价抓取...")
    try:
        # oilprice.py 里的数据调用函数
        oilprice.fetch_30d_history()
        print(f"[{datetime.now()}] ✅ 油价数据抓取完成！")
    except Exception as e:
        print(f"[{datetime.now()}] ❌ 油价数据抓取失败: {e}")

def job_airport():
    print(f"\n[{datetime.now()}] 🏢 开始执行：每 3 天一次的机场数据抓取...")
    try:
        # airport_data.py 里的数据调用函数
        fetch_and_calculate()
        print(f"[{datetime.now()}] ✅ 机场数据抓取完成！")
    except Exception as e:
        print(f"[{datetime.now()}] ❌ 机场数据抓取失败: {e}")

# ==========================================
# 2. 配置并启动总调度器
# ==========================================
if __name__ == "__main__":
    print(f"🚀 [{datetime.now()}] 航空数据总调度中心 (Main Scheduler) 启动！")
    print("--------------------------------------------------")
    
    scheduler = BlockingScheduler()
    
    # 任务 1：OpenSky 实时位置 - 立即执行一次，之后每 3 小时执行一次
    scheduler.add_job(job_opensky, 'interval', hours=3, next_run_time=datetime.now())

    # 任务 2：机场延误数据 - 立即执行一次，之后每 3 天执行一次
    scheduler.add_job(job_airport, 'interval', days=3, next_run_time=datetime.now())

    # 💡 提示：油价因为是每天早上 9 点固定开盘后抓取 (cron)，通常不需要启动时立刻跑，
    # 除非你想测试，如果想测试，可以直接在下面先调用一次 job_oilprice()
    scheduler.add_job(job_oilprice, 'cron', hour=9, minute=0)

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\n⏹️ 总调度中心已安全关闭。")