#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def print_json(value):
    print(json.dumps(value, indent=2, ensure_ascii=False))


def parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def run_command(cmd, timeout=60):
    completed = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
    )
    return {
        "command": cmd,
        "exitCode": completed.returncode,
        "stdout": completed.stdout.strip(),
        "stderr": completed.stderr.strip(),
    }


def latest_file(directory, pattern):
    root = REPO_ROOT / directory
    if not root.exists():
        return None
    matches = list(root.glob(pattern))
    if not matches:
        return None
    return max(matches, key=lambda item: item.stat().st_mtime)


def read_tail(path, lines):
    text = path.read_text(encoding="utf-8", errors="replace")
    chunks = text.splitlines()
    return "\n".join(chunks[-max(1, int(lines)):])


def command_launch(args):
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(REPO_ROOT / "scripts" / "launch-debug-windows.ps1"),
        "-CdpPort",
        str(args.cdp_port),
    ]
    if parse_bool(args.restart):
        cmd.append("-Restart")
    if parse_bool(args.enable_hmr):
        cmd.append("-EnableHmr")
    if parse_bool(args.trace_plugin_imports):
        cmd.append("-TracePluginImports")
    if int(args.auto_quit_after_idle_ms) >= 0:
        cmd.extend(["-AutoQuitAfterIdleMs", str(args.auto_quit_after_idle_ms)])
    print_json(run_command(cmd, timeout=90))


def command_latest_log(args):
    candidates = [
        latest_file(Path(".zenbu") / "logs" / "debug", "zenbu-debug-*.stdout.log"),
        latest_file(Path(".zenbu") / "logs" / "debug", "zenbu-debug-*.stderr.log"),
        latest_file(Path(".zenbu") / "logs" / "perf", "startup-probe-*.log"),
    ]
    candidates = [item for item in candidates if item is not None]
    if not candidates:
        print_json({"error": "No Zenbu debug/perf logs found"})
        return
    path = max(candidates, key=lambda item: item.stat().st_mtime)
    text = read_tail(path, int(args.lines))
    if args.pattern:
        regex = re.compile(args.pattern, re.IGNORECASE)
        text = "\n".join(line for line in text.splitlines() if regex.search(line))
    print_json({"path": str(path), "lines": int(args.lines), "text": text})


def summarize_boot_file(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    events = data.get("events", [])
    spans = [event for event in events if event.get("kind") == "span"]
    marks = [event for event in events if event.get("kind") == "mark"]
    top = sorted(spans, key=lambda item: item.get("durationMs", 0), reverse=True)[:30]
    loader_marks = [mark for mark in marks if mark.get("name", "").startswith("loader-stats")]
    return {
        "path": str(path),
        "totalMs": data.get("totalMs"),
        "spanCount": len(spans),
        "markCount": len(marks),
        "topSpans": [
            {
                "name": item.get("name"),
                "durationMs": item.get("durationMs"),
                "startedAt": item.get("startedAt"),
                "source": item.get("source"),
                "meta": item.get("meta"),
            }
            for item in top
        ],
        "loaderStats": [mark.get("meta") for mark in loader_marks],
        "keyMarks": [
            {"name": mark.get("name"), "at": mark.get("at"), "meta": mark.get("meta")}
            for mark in marks
            if re.search(r"ready|plugins|dynohot|vite|renderer|webContents", mark.get("name", ""), re.I)
        ],
    }


def command_summarize_boot(args):
    path = Path(args.path) if args.path else latest_file(Path(".zenbu") / "logs" / "perf", "startup-probe-*.boot.json")
    if path is None:
        path = latest_file(Path("traces") / "boot", "latest.json")
    if path is None or not path.exists():
        print_json({"error": "No boot trace found"})
        return
    print_json(summarize_boot_file(path))


def fetch_cdp_targets(port):
    url = f"http://127.0.0.1:{int(port)}/json/list"
    with urllib.request.urlopen(url, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def command_cdp_targets(args):
    try:
        print_json({"port": int(args.port), "targets": fetch_cdp_targets(args.port)})
    except (OSError, urllib.error.URLError) as exc:
        print_json({"port": int(args.port), "error": str(exc)})


def command_cdp_eval(args):
    cmd = [
        "node",
        str(REPO_ROOT / "scripts" / "debug" / "cdp-eval.mjs"),
        "--port",
        str(args.port),
        "--expression",
        args.expression,
    ]
    print_json(run_command(cmd, timeout=30))


def command_cdp_smoke(args):
    cmd = [
        "node",
        str(REPO_ROOT / "scripts" / "debug" / "cdp-eval.mjs"),
        "--port",
        str(args.port),
        "--smoke",
    ]
    print_json(run_command(cmd, timeout=30))


def command_processes(_args):
    root_literal = str(REPO_ROOT).replace("'", "''")
    ps = (
        "$root = '" + root_literal + "'; "
        "$items = Get-CimInstance Win32_Process -Filter \"name = 'electron.exe'\" -ErrorAction SilentlyContinue | "
        "Where-Object { ($_.CommandLine -and $_.CommandLine.IndexOf($root, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or "
        "($_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) } | "
        "Select-Object ProcessId, ExecutablePath, CommandLine; "
        "$items | ConvertTo-Json -Compress"
    )
    result = run_command(["powershell.exe", "-NoProfile", "-Command", ps], timeout=20)
    try:
        processes = json.loads(result["stdout"] or "[]")
    except json.JSONDecodeError:
        processes = result["stdout"]
    print_json({"exitCode": result["exitCode"], "processes": processes, "stderr": result["stderr"]})


def main():
    parser = argparse.ArgumentParser(description="Zenbu debug helper for MCPify and shell use")
    sub = parser.add_subparsers(dest="command", required=True)

    launch = sub.add_parser("launch")
    launch.add_argument("--restart", default="true")
    launch.add_argument("--cdp-port", default="9222")
    launch.add_argument("--enable-hmr", default="false")
    launch.add_argument("--trace-plugin-imports", default="false")
    launch.add_argument("--auto-quit-after-idle-ms", default="-1")
    launch.set_defaults(func=command_launch)

    latest = sub.add_parser("latest-log")
    latest.add_argument("--lines", default="200")
    latest.add_argument("--pattern", default="")
    latest.set_defaults(func=command_latest_log)

    boot = sub.add_parser("summarize-boot")
    boot.add_argument("--path", default="")
    boot.set_defaults(func=command_summarize_boot)

    cdp_targets = sub.add_parser("cdp-targets")
    cdp_targets.add_argument("--port", default="9222")
    cdp_targets.set_defaults(func=command_cdp_targets)

    cdp_eval = sub.add_parser("cdp-eval")
    cdp_eval.add_argument("--port", default="9222")
    cdp_eval.add_argument("--expression", required=True)
    cdp_eval.set_defaults(func=command_cdp_eval)

    cdp_smoke = sub.add_parser("cdp-smoke")
    cdp_smoke.add_argument("--port", default="9222")
    cdp_smoke.set_defaults(func=command_cdp_smoke)

    processes = sub.add_parser("processes")
    processes.set_defaults(func=command_processes)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print_json({"error": str(exc)})
        sys.exit(1)
