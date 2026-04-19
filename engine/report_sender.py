"""
Scheduled notification reports — daily and weekly ticket summaries.

Supported channels: Slack, Microsoft Teams, Discord, Line Notify, Email, Notion, Confluence.
Config is stored in the `notification_channel_configs` DB table and read at send time,
so changes take effect without a server restart.

Registered in api/main.py lifespan. Fires every day at 09:00 Asia/Bangkok.
On Mondays it also sends the weekly report.
"""

import asyncio
import base64
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

_ICT = ZoneInfo("Asia/Bangkok")

# ── DB helpers ────────────────────────────────────────────────────────────────

def get_all_notification_channels() -> list[dict]:
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT channel, enabled, config, reports, updated_by, updated_at FROM notification_channel_configs")
        return [dict(r) for r in cur.fetchall()]


def get_notification_channel(channel: str) -> dict | None:
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT channel, enabled, config, reports, updated_by, updated_at FROM notification_channel_configs WHERE channel = %s",
            (channel,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def upsert_notification_channel(channel: str, enabled: bool, config: dict, reports: dict, updated_by: str) -> dict:
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO notification_channel_configs (channel, enabled, config, reports, updated_by, updated_at)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s::uuid, NOW())
            ON CONFLICT (channel) DO UPDATE SET
                enabled    = EXCLUDED.enabled,
                config     = EXCLUDED.config,
                reports    = EXCLUDED.reports,
                updated_by = EXCLUDED.updated_by,
                updated_at = NOW()
            RETURNING channel, enabled, config, reports, updated_by, updated_at
            """,
            (channel, enabled, _json(config), _json(reports), updated_by),
        )
        conn.commit()
        return dict(cur.fetchone())


# ── Report data queries ───────────────────────────────────────────────────────

def _json(obj) -> str:
    import json
    return json.dumps(obj)


def get_report_data(days: int, offset_days: int = 0) -> dict:
    """
    Pull all metrics for a window of `days` days ending `offset_days` days ago.
    offset_days=0  → the most recent `days` days (current period)
    offset_days=days → the period before that (previous period for delta)
    """
    from db.conversation_store import _conn
    with _conn() as conn:
        cur = conn.cursor()

        start = f"NOW() - ('{days + offset_days} days')::interval"
        end   = f"NOW() - ('{offset_days} days')::interval"
        window = f"t.created_at >= {start} AND t.created_at < {end}"

        # Volume
        cur.execute(f"""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE t.status IN ('Closed_Resolved','Closed_Unresolved')) as resolved,
                COUNT(*) FILTER (WHERE t.status NOT IN ('Closed_Resolved','Closed_Unresolved','closed')) as open,
                COUNT(*) FILTER (WHERE t.status = 'Escalated') as escalated
            FROM tickets t WHERE {window}
        """)
        vol = cur.fetchone()

        # Bot vs human
        cur.execute(f"""
            SELECT
                COUNT(*) FILTER (WHERE t.category = 'ai_handling') as bot_count,
                COUNT(*) as total_count
            FROM tickets t WHERE {window}
        """)
        bot = cur.fetchone()

        # FRT and AHT
        cur.execute(f"""
            SELECT
                AVG(EXTRACT(EPOCH FROM (m.created_at - t.created_at))) as avg_frt
            FROM tickets t
            JOIN LATERAL (
                SELECT created_at FROM messages
                WHERE ticket_id = t.id AND sender_type IN ('agent','bot')
                ORDER BY created_at LIMIT 1
            ) m ON true
            WHERE {window}
        """)
        frt_row = cur.fetchone()

        cur.execute(f"""
            SELECT AVG(EXTRACT(EPOCH FROM (t.updated_at - t.created_at))) as avg_aht
            FROM tickets t
            WHERE t.status IN ('Closed_Resolved','Closed_Unresolved')
              AND {window}
        """)
        aht_row = cur.fetchone()

        # CSAT
        cur.execute(f"""
            SELECT AVG(t.csat_score) as avg, COUNT(t.csat_score) as count
            FROM tickets t WHERE t.csat_score IS NOT NULL AND {window}
        """)
        csat_row = cur.fetchone()

        # By channel
        cur.execute(f"""
            SELECT t.channel, COUNT(*) as count
            FROM tickets t WHERE {window}
            GROUP BY t.channel ORDER BY count DESC
        """)
        by_channel = [{"channel": r["channel"], "count": r["count"]} for r in cur.fetchall()]

        # Top categories
        cur.execute(f"""
            SELECT t.category, COUNT(*) as count
            FROM tickets t WHERE {window}
            GROUP BY t.category ORDER BY count DESC LIMIT 5
        """)
        top_categories = [{"category": r["category"], "count": r["count"]} for r in cur.fetchall()]

        # Agent CSAT leaderboard (weekly only, but cheap to always fetch)
        cur.execute(f"""
            SELECT u.name, AVG(t.csat_score) as avg, COUNT(t.csat_score) as count
            FROM tickets t JOIN users u ON t.assigned_to = u.id
            WHERE t.csat_score IS NOT NULL AND {window}
            GROUP BY u.name ORDER BY avg DESC LIMIT 3
        """)
        agent_csat = [{"name": r["name"], "avg": round(float(r["avg"]), 1), "count": r["count"]} for r in cur.fetchall()]

        # Top escalation reasons
        cur.execute(f"""
            SELECT t.category, COUNT(*) as count
            FROM tickets t
            WHERE t.status = 'Escalated' AND {window}
            GROUP BY t.category ORDER BY count DESC LIMIT 3
        """)
        escalation_reasons = [{"category": r["category"], "count": r["count"]} for r in cur.fetchall()]

    total = vol["total"] or 0
    bot_total = bot["total_count"] or 1
    bot_count = bot["bot_count"] or 0

    return {
        "total": total,
        "resolved": vol["resolved"] or 0,
        "open": vol["open"] or 0,
        "escalated": vol["escalated"] or 0,
        "resolution_rate": round((vol["resolved"] or 0) / total, 3) if total else 0,
        "bot_pct": round(bot_count / bot_total * 100),
        "human_pct": round((bot_total - bot_count) / bot_total * 100),
        "avg_frt_s": round(float(frt_row["avg_frt"] or 0)),
        "avg_aht_s": round(float(aht_row["avg_aht"] or 0)),
        "csat_avg": round(float(csat_row["avg"]), 1) if csat_row["avg"] else None,
        "csat_count": csat_row["count"] or 0,
        "by_channel": by_channel,
        "top_categories": top_categories,
        "agent_csat": agent_csat,
        "escalation_reasons": escalation_reasons,
    }


# ── Formatting helpers ─────────────────────────────────────────────────────────

def _fmt_duration(seconds: int) -> str:
    if seconds <= 0:
        return "—"
    m, s = divmod(seconds, 60)
    return f"{m}m {s:02d}s" if m else f"{s}s"


def _delta_str(current: int | float, previous: int | float) -> str:
    if not previous:
        return ""
    diff = current - previous
    if diff == 0:
        return " (→ same)"
    arrow = "↑" if diff > 0 else "↓"
    return f" ({arrow} {abs(diff):.0f} vs prev period)"


def _build_report_lines(data: dict, report_type: str, prev: dict | None = None) -> list[str]:
    """Build a list of plain-text lines that all formatters can use."""
    now_ict = datetime.now(_ICT).strftime("%d %b %Y")
    period = "yesterday" if report_type == "daily" else "last 7 days"
    lines = [f"{'Daily' if report_type == 'daily' else 'Weekly'} CS Report — {now_ict}"]
    lines.append(f"Period: {period}")
    lines.append("")

    # Volume
    lines.append("Ticket Volume")
    delta = _delta_str(data["total"], prev["total"]) if prev else ""
    lines.append(f"  Total received: {data['total']}{delta}")
    lines.append(f"  Resolved: {data['resolved']} ({data['resolution_rate']*100:.0f}%)")
    lines.append(f"  Still open: {data['open']}")
    lines.append(f"  Escalated: {data['escalated']}")
    lines.append("")

    # Bot vs human
    lines.append("Bot vs Human")
    lines.append(f"  AI resolved: {data['bot_pct']}%  |  Human handled: {data['human_pct']}%")
    lines.append("")

    # Response metrics
    lines.append("Response Metrics")
    lines.append(f"  Avg First Response Time: {_fmt_duration(data['avg_frt_s'])}")
    lines.append(f"  Avg Handle Time: {_fmt_duration(data['avg_aht_s'])}")
    lines.append("")

    # CSAT
    if data["csat_count"] > 0:
        lines.append("CSAT")
        lines.append(f"  Avg score: {data['csat_avg']}/5  ({data['csat_count']} ratings)")
        lines.append("")

    # By channel
    if data["by_channel"]:
        lines.append("By Channel")
        for ch in data["by_channel"]:
            lines.append(f"  {ch['channel'].capitalize()}: {ch['count']}")
        lines.append("")

    # Top categories
    if data["top_categories"]:
        lines.append("Top Categories")
        for cat in data["top_categories"]:
            lines.append(f"  {cat['category']}: {cat['count']}")
        lines.append("")

    # Weekly extras
    if report_type == "weekly":
        if data["agent_csat"]:
            lines.append("Agent CSAT Leaderboard")
            for i, a in enumerate(data["agent_csat"], 1):
                lines.append(f"  {i}. {a['name']} — {a['avg']}/5 ({a['count']} ratings)")
            lines.append("")

        if data["escalation_reasons"]:
            lines.append("Top Escalation Reasons")
            for r in data["escalation_reasons"]:
                lines.append(f"  {r['category']}: {r['count']}")
            lines.append("")

    return lines


# ── Channel formatters ─────────────────────────────────────────────────────────

def _fmt_slack(data: dict, report_type: str, prev: dict | None) -> list[dict]:
    """Slack Block Kit payload."""
    now_ict = datetime.now(_ICT).strftime("%d %b %Y")
    title = f"{'📋 Daily' if report_type == 'daily' else '📊 Weekly'} CS Report — {now_ict}"
    period = "yesterday" if report_type == "daily" else "last 7 days"

    delta = ""
    if prev:
        delta = _delta_str(data["total"], prev["total"])

    res_rate = f"{data['resolution_rate']*100:.0f}%"

    channel_str = "  ".join(f"{c['channel'].capitalize()} {c['count']}" for c in data["by_channel"])
    cat_str = "\n".join(f"• {c['category']}: {c['count']}" for c in data["top_categories"])

    blocks: list[dict] = [
        {"type": "header", "text": {"type": "plain_text", "text": title}},
        {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Period: {period}"}]},
        {"type": "divider"},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Total Tickets*\n{data['total']}{delta}"},
            {"type": "mrkdwn", "text": f"*Resolved*\n{data['resolved']} ({res_rate})"},
            {"type": "mrkdwn", "text": f"*Still Open*\n{data['open']}"},
            {"type": "mrkdwn", "text": f"*Escalated*\n{data['escalated']}"},
        ]},
        {"type": "divider"},
        {"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*Bot Resolved*\n{data['bot_pct']}%"},
            {"type": "mrkdwn", "text": f"*Human Handled*\n{data['human_pct']}%"},
            {"type": "mrkdwn", "text": f"*Avg FRT*\n{_fmt_duration(data['avg_frt_s'])}"},
            {"type": "mrkdwn", "text": f"*Avg Handle Time*\n{_fmt_duration(data['avg_aht_s'])}"},
        ]},
    ]

    if data["csat_count"] > 0:
        blocks.append({"type": "section", "fields": [
            {"type": "mrkdwn", "text": f"*CSAT*\n{data['csat_avg']}/5 ({data['csat_count']} ratings)"},
        ]})

    if channel_str:
        blocks.append({"type": "divider"})
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*By Channel*\n{channel_str}"}})

    if cat_str:
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Top Categories*\n{cat_str}"}})

    if report_type == "weekly":
        if data["agent_csat"]:
            leaderboard = "\n".join(
                f"{i}. {a['name']} — {a['avg']}/5 ({a['count']} ratings)"
                for i, a in enumerate(data["agent_csat"], 1)
            )
            blocks.append({"type": "divider"})
            blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Agent CSAT Leaderboard*\n{leaderboard}"}})

        if data["escalation_reasons"]:
            esc = "\n".join(f"• {r['category']}: {r['count']}" for r in data["escalation_reasons"])
            blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": f"*Top Escalation Reasons*\n{esc}"}})

    return blocks


def _fmt_teams(data: dict, report_type: str, prev: dict | None) -> dict:
    """Microsoft Teams Adaptive Card payload."""
    lines = _build_report_lines(data, report_type, prev)
    text = "\n".join(lines)
    return {
        "type": "message",
        "attachments": [{
            "contentType": "application/vnd.microsoft.card.adaptive",
            "content": {
                "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                "type": "AdaptiveCard",
                "version": "1.3",
                "body": [{"type": "TextBlock", "text": text, "wrap": True, "fontType": "Monospace"}],
            },
        }],
    }


def _fmt_discord(data: dict, report_type: str, prev: dict | None) -> dict:
    """Discord webhook payload."""
    lines = _build_report_lines(data, report_type, prev)
    content = "```\n" + "\n".join(lines) + "\n```"
    return {"content": content}


def _fmt_line(data: dict, report_type: str, prev: dict | None) -> str:
    """Line Notify message string."""
    lines = _build_report_lines(data, report_type, prev)
    return "\n" + "\n".join(lines)


def _fmt_email_html(data: dict, report_type: str, prev: dict | None) -> tuple[str, str]:
    """Returns (subject, html_body)."""
    now_ict = datetime.now(_ICT).strftime("%d %b %Y")
    subject = f"{'Daily' if report_type == 'daily' else 'Weekly'} CS Report — {now_ict}"
    lines = _build_report_lines(data, report_type, prev)
    html_lines = ["<pre style='font-family:monospace;font-size:14px;line-height:1.6'>"]
    html_lines += [line.replace("&", "&amp;").replace("<", "&lt;") for line in lines]
    html_lines.append("</pre>")
    return subject, "\n".join(html_lines)


def _fmt_notion_blocks(data: dict, report_type: str, prev: dict | None) -> list[dict]:
    """Notion API block children."""
    now_ict = datetime.now(_ICT).strftime("%d %b %Y")
    title = f"{'Daily' if report_type == 'daily' else 'Weekly'} CS Report — {now_ict}"
    lines = _build_report_lines(data, report_type, prev)

    blocks = [{
        "object": "block",
        "type": "heading_2",
        "heading_2": {"rich_text": [{"type": "text", "text": {"content": title}}]},
    }]
    for line in lines:
        blocks.append({
            "object": "block",
            "type": "paragraph",
            "paragraph": {"rich_text": [{"type": "text", "text": {"content": line or " "}}]},
        })
    return blocks


def _fmt_confluence_storage(data: dict, report_type: str, prev: dict | None) -> str:
    """Confluence storage format (XHTML)."""
    lines = _build_report_lines(data, report_type, prev)
    content = "\n".join(lines).replace("&", "&amp;").replace("<", "&lt;")
    return f"<pre>{content}</pre>"


# ── Channel senders ────────────────────────────────────────────────────────────

async def _send_slack(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    blocks = _fmt_slack(data, report_type, prev)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(cfg["webhook_url"], json={"blocks": blocks})
        r.raise_for_status()


async def _send_teams(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    payload = _fmt_teams(data, report_type, prev)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(cfg["webhook_url"], json=payload)
        r.raise_for_status()


async def _send_discord(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    payload = _fmt_discord(data, report_type, prev)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(cfg["webhook_url"], json=payload)
        r.raise_for_status()


async def _send_line(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    message = _fmt_line(data, report_type, prev)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://notify-api.line.me/api/notify",
            headers={"Authorization": f"Bearer {cfg['token']}"},
            data={"message": message},
        )
        r.raise_for_status()


async def _send_email(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    subject, html_body = _fmt_email_html(data, report_type, prev)
    raw_to = cfg.get("to_emails", "")
    to_emails = [e.strip() for e in raw_to.split(",") if e.strip()] if isinstance(raw_to, str) else list(raw_to)
    if not to_emails:
        return

    # Always use Gmail API via the service account (GMAIL_CREDENTIALS_JSON) —
    # same credentials the email channel uses, no SMTP password needed.
    from config import settings
    from email.message import EmailMessage

    from_email = settings.GMAIL_SUPPORT_EMAIL

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_email
    msg["To"] = ", ".join(to_emails)
    msg.set_content("Please view this email in an HTML-capable client.")
    msg.add_alternative(html_body, subtype="html")

    raw_b64 = base64.urlsafe_b64encode(msg.as_bytes()).decode()

    def _send():
        from api.routes.email import _get_gmail_session
        session = _get_gmail_session()
        r = session.post(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            json={"raw": raw_b64},
        )
        r.raise_for_status()

    await asyncio.get_event_loop().run_in_executor(None, _send)


async def _send_notion(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    page_id = cfg["page_id"]
    token = cfg["token"]
    blocks = _fmt_notion_blocks(data, report_type, prev)
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.patch(
            f"https://api.notion.com/v1/blocks/{page_id}/children",
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": "2022-06-28",
                "Content-Type": "application/json",
            },
            json={"children": blocks},
        )
        r.raise_for_status()


async def _send_confluence(cfg: dict, data: dict, report_type: str, prev: dict | None) -> None:
    site_url = cfg["site_url"].rstrip("/")
    email = cfg["email"]
    token = cfg["api_token"]
    space_key = cfg["space_key"]
    page_title = cfg.get("page_title", "CS Bot Reports")
    now_ict = datetime.now(_ICT).strftime("%d %b %Y")
    version_title = f"{'Daily' if report_type == 'daily' else 'Weekly'} CS Report — {now_ict}"
    storage_body = _fmt_confluence_storage(data, report_type, prev)

    auth = (email, token)
    base = f"{site_url}/wiki/rest/api"

    async with httpx.AsyncClient(timeout=20, auth=auth) as client:
        # Find existing page
        r = await client.get(f"{base}/content", params={"title": page_title, "spaceKey": space_key, "expand": "version"})
        r.raise_for_status()
        results = r.json().get("results", [])

        if results:
            page_id = results[0]["id"]
            version = results[0]["version"]["number"] + 1
            r = await client.put(
                f"{base}/content/{page_id}",
                json={
                    "version": {"number": version},
                    "title": page_title,
                    "type": "page",
                    "body": {"storage": {"value": storage_body, "representation": "storage"}},
                },
            )
        else:
            r = await client.post(
                f"{base}/content",
                json={
                    "type": "page",
                    "title": page_title,
                    "space": {"key": space_key},
                    "body": {"storage": {"value": storage_body, "representation": "storage"}},
                },
            )
        r.raise_for_status()


_SENDERS = {
    "slack":       _send_slack,
    "teams":       _send_teams,
    "discord":     _send_discord,
    "line":        _send_line,
    "email":       _send_email,
    "notion":      _send_notion,
    "confluence":  _send_confluence,
}


# ── Orchestration ─────────────────────────────────────────────────────────────

async def send_reports(report_type: str) -> None:
    """Send `report_type` ('daily' or 'weekly') to all enabled channels."""
    channels = get_all_notification_channels()
    enabled = [c for c in channels if c["enabled"] and c["reports"].get(report_type, True)]
    if not enabled:
        logger.info("report_sender: no channels enabled for %s report", report_type)
        return

    days = 1 if report_type == "daily" else 7
    data = get_report_data(days)
    prev = get_report_data(days, offset_days=days) if report_type == "weekly" else None

    for ch in enabled:
        channel = ch["channel"]
        sender = _SENDERS.get(channel)
        if not sender:
            logger.warning("report_sender: unknown channel %s, skipping", channel)
            continue
        try:
            await sender(ch["config"], data, report_type, prev)
            logger.info("report_sender: posted %s report to %s", report_type, channel)
        except Exception:
            logger.exception("report_sender: failed to send %s report to %s", report_type, channel)


async def send_test_report(channel: str, config: dict, report_type: str = "daily") -> None:
    """Send a test report to a single channel with the given config."""
    sender = _SENDERS.get(channel)
    if not sender:
        raise ValueError(f"Unknown channel: {channel}")
    days = 7 if report_type == "weekly" else 1
    data = get_report_data(days)
    prev = get_report_data(days, offset_days=days) if report_type == "weekly" else None
    await sender(config, data, report_type, prev)


# ── Scheduler loop ────────────────────────────────────────────────────────────

async def start_report_scheduler_loop() -> None:
    """Infinite loop — registered as asyncio task in api/main.py lifespan.
    Wakes at 09:00 Asia/Bangkok every day, sends daily report.
    On Mondays also sends weekly report.
    """
    while True:
        now = datetime.now(_ICT)
        target = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        wait = (target - now).total_seconds()
        logger.info("report_sender: next run in %.0f s (at %s ICT)", wait, target.strftime("%H:%M %d %b"))
        await asyncio.sleep(wait)

        try:
            await send_reports("daily")
        except Exception:
            logger.exception("report_sender: error sending daily report")

        try:
            if datetime.now(_ICT).weekday() == 0:  # Monday
                await send_reports("weekly")
        except Exception:
            logger.exception("report_sender: error sending weekly report")
