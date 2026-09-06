#!/usr/bin/env python3
"""
9router Telegram Backup Bot
Exports PostgreSQL data and sends to Telegram as encrypted file.
"""

import json
import gzip
import subprocess
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

def load_config():
    with open(CONFIG_PATH, "r") as f:
        return json.load(f)

def export_table(db_user, db_name, table):
    """Export a single table to JSON via psql."""
    query = f"SELECT json_agg(row_to_json(t)) FROM (SELECT * FROM {table}) t;"
    cmd = [
        "sudo", "-u", db_user, "psql",
        "-d", db_name, "-t", "-A", "-c", query
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"  WARNING: Failed to export {table}: {result.stderr.strip()}", file=sys.stderr)
        return []
    raw = result.stdout.strip()
    if not raw or raw == "":
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        print(f"  WARNING: Invalid JSON from {table}", file=sys.stderr)
        return []

def get_table_columns(db_user, db_name, table):
    """Get column names for a table."""
    query = f"""
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = '{table}' ORDER BY ordinal_position;
    """
    cmd = ["sudo", "-u", db_user, "psql", "-d", db_name, "-t", "-A", "-c", query]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    return [c.strip() for c in result.stdout.strip().split("\n") if c.strip()]

def create_backup(config):
    """Create a full backup JSON."""
    wib = timezone(timedelta(hours=7))
    now = datetime.now(wib)
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    
    backup = {
        "metadata": {
            "created_at": now.isoformat(),
            "version": "1.0",
            "source": "9router-vps"
        },
        "data": {}
    }
    
    db_user = config["db_user"]
    db_name = config["db_name"]
    
    total_rows = 0
    for table in config["tables"]:
        print(f"  Exporting {table}...")
        rows = export_table(db_user, db_name, table)
        backup["data"][table] = rows
        total_rows += len(rows)
        print(f"    -> {len(rows)} rows")
    
    # Save compressed backup
    backup_dir = config["backup_dir"]
    filename = f"9router_backup_{timestamp}.json.gz"
    filepath = os.path.join(backup_dir, filename)
    
    with gzip.open(filepath, "wt", encoding="utf-8") as f:
        json.dump(backup, f, indent=2, default=str)
    
    file_size = os.path.getsize(filepath)
    print(f"\n  Backup created: {filename} ({file_size:,} bytes)")
    print(f"  Total rows: {total_rows}")
    
    return filepath, filename, total_rows

def send_telegram_file(token, chat_id, filepath, filename, caption):
    """Send file to Telegram."""
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    
    # Build multipart form data
    boundary = "----9routerBackupBoundary"
    
    with open(filepath, "rb") as f:
        file_data = f.read()
    
    body = bytearray()
    
    # Chat ID field
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="chat_id"\r\n\r\n')
    body.extend(f"{chat_id}\r\n".encode())
    
    # Caption field
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="caption"\r\n\r\n')
    body.extend(f"{caption}\r\n".encode())
    
    # Parse mode
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(b'Content-Disposition: form-data; name="parse_mode"\r\n\r\n')
    body.extend(b"HTML\r\n")
    
    # File field
    body.extend(f"--{boundary}\r\n".encode())
    body.extend(f'Content-Disposition: form-data; name="document"; filename="{filename}"\r\n'.encode())
    body.extend(b"Content-Type: application/gzip\r\n\r\n")
    body.extend(file_data)
    body.extend(b"\r\n")
    
    # End boundary
    body.extend(f"--{boundary}--\r\n".encode())
    
    req = urllib.request.Request(
        url,
        data=bytes(body),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST"
    )
    
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read())
            if result.get("ok"):
                print("  Sent to Telegram successfully!")
                return True
            else:
                print(f"  Telegram API error: {result}", file=sys.stderr)
                return False
    except urllib.error.URLError as e:
        print(f"  Failed to send: {e}", file=sys.stderr)
        return False

def send_telegram_message(token, chat_id, text):
    """Send a text message to Telegram."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    data = json.dumps({
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read()).get("ok", False)
    except Exception:
        return False

def cleanup_old_backups(backup_dir, keep=7):
    """Keep only the last N backup files."""
    files = [
        f for f in os.listdir(backup_dir)
        if f.startswith("9router_backup_") and f.endswith(".json.gz")
    ]
    files.sort(reverse=True)
    for f in files[keep:]:
        os.remove(os.path.join(backup_dir, f))
        print(f"  Cleaned up old backup: {f}")

def main():
    msg = (
        "9router DB backup is DISABLED. "
        "Refusing to export tables or send Telegram documents (key_plain leak)."
    )
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", file=sys.stderr)
    sys.exit(2)

if __name__ == "__main__":
    main()
