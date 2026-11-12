#!/usr/bin/env python3
"""Audit Claude Code session transcripts for token-bloat patterns.

Run periodically (e.g. monthly) to verify the rules in `.claude/rules/efficiency.md`
are working. Compares against the 2026-05-05 baseline in
`docs/reports/2026-05-05-token-bloat-audit.md`.

Usage:
    python3 scripts/audit-token-bloat.py [PATH...]

Defaults to scanning all surevax session transcripts in ~/.claude/projects/.

Looks for:
    - Parallel tool batches (target: >0%, was 0%)
    - Mean thinking chars per session (target: <5K, was 11K)
    - Redundant Reads (target: 0, was 162 across 44 sessions)
    - Narration filler "Let me check" / "Now let me" (target: <2/session, was ~4)
    - Tool-result size distribution by tool name
    - Always-loaded budget (target: <800 lines, was 1,144)
"""
import json, os, re, glob, sys
from collections import Counter, defaultdict


def analyze_session(path):
    stats = {
        "path": path,
        "size_bytes": os.path.getsize(path),
        "thinking_chars": 0,
        "narration_chars": 0,
        "narration_blocks": 0,
        "filler_count": 0,
        "asst_msgs": 0,
        "user_msgs": 0,
        "user_corrections": 0,
        "ship_signals": 0,
        "error_signals": 0,
        "reads_by_file": Counter(),
        "tool_calls": Counter(),
        "tool_size_by_name": defaultdict(list),
        "parallel_groups": 0,
        "single_tool_results": 0,
    }
    filler_re = re.compile(
        r"\b(Let me check|Let me also|Let me read|Let me first|Now let me|I'll check|I'll start by|Looking at)\b",
        re.I,
    )
    correction_pats = [
        re.compile(r"\b(wrong|incorrect)\b", re.I),
        re.compile(r"\b(actually|instead)\b", re.I),
        re.compile(r"\b(don't|do not|stop|redo|fix|broken)\b", re.I),
        re.compile(r"\bthat's not\b", re.I),
    ]
    ship_re = re.compile(r"(gh pr create|git commit|git push)")

    try:
        with open(path) as f:
            msgs = [json.loads(line) for line in f if line.strip()]
    except Exception:
        return None

    tool_use_id_to_name = {}
    for m in msgs:
        msg = m.get("message", {})
        role = msg.get("role") or m.get("type")
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue

        if role == "assistant":
            stats["asst_msgs"] += 1
            for c in content:
                t = c.get("type")
                if t == "thinking":
                    stats["thinking_chars"] += len(c.get("thinking", ""))
                elif t == "text":
                    txt = c.get("text", "")
                    if txt:
                        stats["narration_chars"] += len(txt)
                        stats["narration_blocks"] += 1
                        stats["filler_count"] += len(filler_re.findall(txt))
                elif t == "tool_use":
                    tool_use_id_to_name[c.get("id")] = c.get("name")
                    stats["tool_calls"][c.get("name", "")] += 1
                    inp = c.get("input", {})
                    if c.get("name") == "Read":
                        fp = inp.get("file_path", "")
                        if fp:
                            stats["reads_by_file"][fp] += 1
                    if c.get("name") == "Bash":
                        cmd = inp.get("command", "")
                        if ship_re.search(cmd):
                            stats["ship_signals"] += 1

        elif role == "user":
            tool_results = [c for c in content if c.get("type") == "tool_result"]
            if len(tool_results) >= 2:
                stats["parallel_groups"] += 1
            elif len(tool_results) == 1:
                stats["single_tool_results"] += 1

            for c in tool_results:
                tu_id = c.get("tool_use_id")
                tool_name = tool_use_id_to_name.get(tu_id, "unknown")
                body = c.get("content", "")
                if isinstance(body, list):
                    body = "".join(b.get("text", "") for b in body if isinstance(b, dict))
                sz = len(body) if isinstance(body, str) else 0
                stats["tool_size_by_name"][tool_name].append(sz)
                if isinstance(body, str) and re.search(
                    r"\b(Error:|FAILED|exit code [1-9]|✗|✘)", body
                ):
                    stats["error_signals"] += 1

            for c in content:
                if c.get("type") == "text" or (
                    isinstance(c, dict) and c.get("type") is None and c.get("text")
                ):
                    txt = c.get("text", "")
                    if txt and len(txt) < 2000:
                        stats["user_msgs"] += 1
                        for p in correction_pats:
                            if p.search(txt):
                                stats["user_corrections"] += 1
                                break

    return stats


def main(paths=None):
    if not paths:
        # Default: all surevax session transcripts.
        home = os.path.expanduser("~")
        paths = sorted(
            glob.glob(
                f"{home}/.claude/projects/-Users-*-surevax-cms-revamp*/*.jsonl"
            )
        )
        paths = [p for p in paths if os.path.getsize(p) >= 200_000]

    if not paths:
        print("No session transcripts found.")
        return 1

    results = []
    for p in paths:
        s = analyze_session(p)
        if s:
            results.append(s)

    n = len(results)
    if n == 0:
        return 1

    total_tool_results = sum(r["parallel_groups"] + r["single_tool_results"] for r in results)
    parallel_results_count = sum(
        sum(1 for k in [r["parallel_groups"]] if k > 0) * r["parallel_groups"]
        for r in results
    )
    # parallel ratio: how many tool_use msgs were in batches of >=2
    total_batched = sum(r["parallel_groups"] for r in results)
    parallel_ratio = total_batched / max(1, total_tool_results)

    total_thinking = sum(r["thinking_chars"] for r in results)
    avg_thinking = total_thinking / n
    total_narration = sum(r["narration_chars"] for r in results)
    avg_filler = sum(r["filler_count"] for r in results) / n

    redundant_reads = sum(
        sum(c - 1 for c in r["reads_by_file"].values() if c > 1) for r in results
    )

    avg_corrections = sum(r["user_corrections"] for r in results) / n
    avg_ship = sum(r["ship_signals"] for r in results) / n
    avg_errors = sum(r["error_signals"] for r in results) / n

    # Tool size aggregates
    by_tool = defaultdict(list)
    for r in results:
        for name, sizes in r["tool_size_by_name"].items():
            by_tool[name].extend(sizes)

    print(f"=== TOKEN-BLOAT AUDIT ({n} sessions) ===\n")
    print(f"Parallel tool batches: {total_batched:,} / {total_tool_results:,} tool calls ({parallel_ratio:.1%})")
    print(f"  Target: > 0%  |  2026-05-05 baseline: 0.0%")
    print()
    print(f"Thinking chars: total {total_thinking:,} (~{total_thinking//4:,} tok), avg/session {avg_thinking:,.0f}")
    print(f"  Target: < 5,000 chars/session  |  baseline: 10,696")
    print()
    print(f"Redundant Reads: {redundant_reads:,}")
    print(f"  Target: 0  |  baseline: 162")
    print()
    print(f"Narration filler 'Let me check' etc: avg {avg_filler:.1f}/session")
    print(f"  Target: < 2/session  |  baseline: ~4.1")
    print()
    print(f"User corrections (per session): {avg_corrections:.2f}")
    print(f"Ship signals (commits/pushes): {avg_ship:.1f}")
    print(f"Error signals: {avg_errors:.1f}")
    print()
    print("=== TOOL RESULT SIZE BY NAME (top 10) ===")
    for name, sizes in sorted(by_tool.items(), key=lambda x: -sum(x[1]))[:10]:
        sizes.sort()
        avg = sum(sizes) / len(sizes) / 1024
        p95 = sizes[int(len(sizes) * 0.95)] / 1024 if sizes else 0
        total_kb = sum(sizes) / 1024
        print(
            f"  {name:45s}  n={len(sizes):4d}  avg={avg:6.1f}KB  p95={p95:6.1f}KB  total={total_kb:8.1f}KB"
        )

    print("\n=== ALWAYS-LOADED BUDGET ===")
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    rules_glob = os.path.join(repo_root, ".claude/rules/*.md")
    claude_md = os.path.join(repo_root, "CLAUDE.md")
    total_lines = 0
    for f in sorted(glob.glob(rules_glob)) + [claude_md]:
        if os.path.exists(f):
            with open(f) as fh:
                lines = sum(1 for _ in fh)
            print(f"  {os.path.relpath(f, repo_root):60s} {lines:5d} lines")
            total_lines += lines
    print(f"  {'TOTAL':60s} {total_lines:5d} lines")
    print(f"  Target: < 800 lines  |  baseline: 1,144")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
