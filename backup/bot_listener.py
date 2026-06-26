#!/usr/bin/env python3
"""
9router Telegram Bot Listener
Handles /backup, /status, and /help commands.
"""

import json
import os
import subprocess
import urllib.request
import urllib.error
import time
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

def load_config():
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)

def get_db_status(config):
    query = """
    SELECT 
      (SELECT COUNT(*) FROM buyers) as total_buyers,
      (SELECT COUNT(*) FROM api_keys WHERE deleted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())) as total_active_keys,
      (SELECT COUNT(*) FROM usage_rollups) as total_rollups;
    """
    cmd = ["sudo", "-u", config["db_user"], "psql", "-d", config["db_name"], "-t", "-A", "-c", query]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if result.returncode == 0:
        parts = result.stdout.strip().split("|")
        if len(parts) >= 3:
            return f"• Buyers: {parts[0].strip()}\n• Active Keys: {parts[1].strip()}\n• Usage Rollups: {parts[2].strip()}"
    return "Failed to fetch DB status."

def get_last_backup():
    backup_dir = SCRIPT_DIR
    files = [f for f in os.listdir(backup_dir) if f.startswith("9router_backup_") and f.endswith(".json.gz")]
    if not files:
        return "No backups found."
    files.sort(reverse=True)
    latest = files[0]
    stat = os.stat(os.path.join(backup_dir, latest))
    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone(timedelta(hours=7)))
    size_kb = stat.st_size / 1024
    return f"• File: {latest}\n• Size: {size_kb:.1f} KB\n• Time: {mtime.strftime('%Y-%m-%d %H:%M')} WIB"

def get_system_info():
    """Get system resource information: RAM, swap, disk, uptime, load."""
    info = {}
    
    # RAM & Swap from free -h
    try:
        result = subprocess.run(["free", "-h"], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split("\n")
        for line in lines:
            if line.startswith("Mem:"):
                parts = line.split()
                info["ram_total"] = parts[1]
                info["ram_used"] = parts[2]
                info["ram_available"] = parts[6] if len(parts) > 6 else parts[3]
            elif line.startswith("Swap:"):
                parts = line.split()
                info["swap_total"] = parts[1]
                info["swap_used"] = parts[2]
                info["swap_free"] = parts[3]
    except Exception as e:
        info["ram_error"] = str(e)
    
    # Disk usage
    try:
        result = subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=5)
        lines = result.stdout.strip().split("\n")
        if len(lines) >= 2:
            parts = lines[1].split()
            info["disk_total"] = parts[1]
            info["disk_used"] = parts[2]
            info["disk_available"] = parts[3]
            info["disk_percent"] = parts[4]
    except Exception as e:
        info["disk_error"] = str(e)
    
    # Uptime
    try:
        result = subprocess.run(["uptime", "-p"], capture_output=True, text=True, timeout=5)
        info["uptime"] = result.stdout.strip().replace("up ", "")
    except Exception:
        info["uptime"] = "N/A"
    
    # Load average
    try:
        with open("/proc/loadavg", "r") as f:
            load_data = f.read().split()
            info["load_1min"] = load_data[0]
            info["load_5min"] = load_data[1]
            info["load_15min"] = load_data[2]
    except Exception:
        info["load_1min"] = info["load_5min"] = info["load_15min"] = "N/A"
    
    return info

def send_message(token, chat_id, text, reply_to_message_id=None, inline_keyboard=None):
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    if reply_to_message_id:
        data["reply_to_message_id"] = reply_to_message_id
    if inline_keyboard:
        data["reply_markup"] = inline_keyboard
        
    req = urllib.request.Request(
        url, data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        print(f"Send message error: {e}")
        return None

def get_main_menu_keyboard():
    return {
        "inline_keyboard": [
            [
                {"text": "💾 Backup Manual", "callback_data": "backup"},
                {"text": "📊 Status DB", "callback_data": "status"}
            ],
            [
                {"text": "🖥️ Server Info", "callback_data": "system"},
                {"text": "❓ Help", "callback_data": "help"}
            ]
        ]
    }

def handle_updates(config):
    token = config["bot_token"]
    chat_id = config["chat_id"]
    offset = 0
    
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Bot listener started. Polling for updates...")
    
    while True:
        try:
            url = f"https://api.telegram.org/bot{token}/getUpdates?offset={offset}&timeout=30"
            with urllib.request.urlopen(url, timeout=35) as resp:
                data = json.loads(resp.read())
                if not data.get("ok"):
                    time.sleep(5)
                    continue
                
                for update in data.get("result", []):
                    offset = update["update_id"] + 1
                    
                    # Handle callback queries (button clicks)
                    callback_query = update.get("callback_query")
                    if callback_query:
                        cb_msg = callback_query["message"]
                        cb_chat_id = str(cb_msg["chat"]["id"])
                        cb_data = callback_query["data"]
                        cb_msg_id = cb_msg["message_id"]
                        
                        if cb_chat_id != chat_id:
                            continue
                        
                        # Answer callback to remove loading spinner
                        ack_url = f"https://api.telegram.org/bot{token}/answerCallbackQuery"
                        ack_data = {"callback_query_id": callback_query["id"]}
                        try:
                            urllib.request.urlopen(
                                urllib.request.Request(ack_url, data=json.dumps(ack_data).encode(), headers={"Content-Type": "application/json"}, method="POST"),
                                timeout=5
                            )
                        except Exception:
                            pass
                        
                        # Process the callback data same as text commands
                        text = f"/{cb_data}"
                        msg_id = cb_msg_id
                        is_callback = True
                    else:
                        # Handle regular text messages
                        message = update.get("message")
                        if not message:
                            continue
                        
                        msg_chat_id = str(message["chat"]["id"])
                        if msg_chat_id != chat_id:
                            continue
                        
                        text = message.get("text", "").strip()
                        msg_id = message["message_id"]
                        is_callback = False
                    
                    # Command routing
                    if text in ["/status", "status"]:
                        db_status = get_db_status(config)
                        last_backup = get_last_backup()
                        reply = (
                            f"<b>📊 9router System Status</b>\n\n"
                            f"<b>Database:</b>\n{db_status}\n\n"
                            f"<b>Last Backup:</b>\n{last_backup}"
                        )
                        send_message(token, chat_id, reply, msg_id, get_main_menu_keyboard() if is_callback else None)
                        
                    elif text in ["/system", "/server", "system", "server"]:
                        sys_info = get_system_info()
                        reply = (
                            f"<b>🖥️ Server Resource Status</b>\n\n"
                            f"<b>💾 RAM:</b>\n"
                            f"• Total: {sys_info.get('ram_total', 'N/A')}\n"
                            f"• Used: {sys_info.get('ram_used', 'N/A')}\n"
                            f"• Available: {sys_info.get('ram_available', 'N/A')}\n\n"
                            f"<b>🔄 Swap:</b>\n"
                            f"• Total: {sys_info.get('swap_total', 'N/A')}\n"
                            f"• Used: {sys_info.get('swap_used', 'N/A')}\n"
                            f"• Free: {sys_info.get('swap_free', 'N/A')}\n\n"
                            f"<b>💿 Disk (SSD):</b>\n"
                            f"• Total: {sys_info.get('disk_total', 'N/A')}\n"
                            f"• Used: {sys_info.get('disk_used', 'N/A')} ({sys_info.get('disk_percent', 'N/A')})\n"
                            f"• Available: {sys_info.get('disk_available', 'N/A')}\n\n"
                            f"<b>⏱️ Uptime:</b> {sys_info.get('uptime', 'N/A')}\n"
                            f"<b>📈 Load Average:</b> {sys_info.get('load_1min', 'N/A')}, {sys_info.get('load_5min', 'N/A')}, {sys_info.get('load_15min', 'N/A')}"
                        )
                        send_message(token, chat_id, reply, msg_id, get_main_menu_keyboard() if is_callback else None)
                        
                    elif text in ["/backup", "backup"]:
                        if is_callback:
                            send_message(token, chat_id, "⏳ Starting manual backup, please wait...", msg_id)
                        else:
                            send_message(token, chat_id, "⏳ Starting manual backup, please wait...", msg_id, get_main_menu_keyboard())
                        
                        result = subprocess.run(
                            ["python3", os.path.join(SCRIPT_DIR, "backup.py")], 
                            capture_output=True, text=True, timeout=120
                        )
                        if result.returncode == 0:
                            send_message(token, chat_id, "✅ Manual backup completed successfully! The file has been sent to this chat.", msg_id, get_main_menu_keyboard())
                        else:
                            send_message(token, chat_id, f"❌ Backup failed.\nError: {result.stderr}", msg_id, get_main_menu_keyboard())
                        
                    elif text in ["/start", "/help", "start", "help"]:
                        reply = (
                            f"<b>🤖 9router Backup Bot</b>\n\n"
                            f"Gunakan tombol di bawah atau ketik perintah:\n"
                            f"• <b>/status</b> - Cek statistik database & backup terakhir\n"
                            f"• <b>/system</b> - Cek RAM, Swap, Disk SSD, Uptime\n"
                            f"• <b>/backup</b> - Trigger backup manual & kirim file\n"
                        )
                        send_message(token, chat_id, reply, msg_id, get_main_menu_keyboard())
                        
        except urllib.error.URLError as e:
            print(f"Network error: {e}")
            time.sleep(5)
        except Exception as e:
            print(f"Unexpected error: {e}")
            time.sleep(5)

if __name__ == "__main__":
    config = load_config()
    handle_updates(config)
