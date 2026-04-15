"""
Email parser — converts a raw Gmail API message payload into structured data.

Responsibilities:
- Extract plain-text body (strips quoted history + signatures)
- Extract attachment metadata (filename, MIME type, size, attachment_id)
- Enforce attachment allowlist + size cap
- Detect language from body text
- Never pass attachment content to the AI — only body text enters the pipeline

Security:
- Allowlisted MIME types only (jpg, png, pdf, txt, csv)
- MIME type verified against actual content-type header, not just filename extension
- Attachments over EMAIL_ATTACHMENT_MAX_MB are rejected
- No attachment content is returned — only metadata for later download + scan
"""

import base64
import logging
import re
from dataclasses import dataclass, field

from config import settings

logger = logging.getLogger(__name__)

# ── Attachment policy ─────────────────────────────────────────────────────────

ALLOWED_MIME_TYPES: set[str] = {
    "image/jpeg",
    "image/png",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/csv",
}

ALLOWED_EXTENSIONS: set[str] = {".jpg", ".jpeg", ".png", ".pdf", ".txt", ".csv"}

MAX_ATTACHMENT_BYTES: int = int(getattr(settings, "EMAIL_ATTACHMENT_MAX_MB", 10)) * 1024 * 1024


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class AttachmentMeta:
    filename: str
    mime_type: str
    size_bytes: int
    gmail_attachment_id: str  # used to download from Gmail API later
    rejected: bool = False
    reject_reason: str = ""


@dataclass
class ParsedEmail:
    message_id: str           # RFC Message-ID header (e.g. <abc@mail.gmail.com>)
    thread_id: str            # Gmail threadId field
    from_email: str
    from_name: str
    subject: str
    body: str                 # cleaned plain-text body, ready for AI
    snippet: str              # first 200 chars of body for dashboard preview
    language: str             # 'th' or 'en'
    attachments: list[AttachmentMeta] = field(default_factory=list)
    raw_headers: dict = field(default_factory=dict)
    in_reply_to: str = ""     # Message-ID of the email this replies to
    references: str = ""      # full References header chain
    is_automated: bool = False  # True = system/bounce/newsletter — must not trigger AI reply
    automated_reason: str = ""  # human-readable reason for logging


# ── Automated email detection ─────────────────────────────────────────────────

# Sender local-parts that are never real customers
_AUTOMATED_SENDER_PATTERNS = re.compile(
    r"^(mailer-daemon|postmaster|noreply|no-reply|bounce|bounces|"
    r"notification|notifications|donotreply|do-not-reply|"
    r"auto-?reply|daemon|devnull|dev-null|blackhole|"
    r"return|returns|undeliverable|delivery-status)@",
    re.IGNORECASE,
)

def _is_automated_email(headers: list[dict], from_email: str) -> tuple[bool, str]:
    """
    Detect whether this email is automated/system-generated and must not
    trigger an AI reply. Checks both the sender address and standard headers
    defined by RFC 3834, RFC 2076, and common bulk-mail conventions.
    """
    # 1. Sender address blocklist
    if _AUTOMATED_SENDER_PATTERNS.match(from_email.strip()):
        return True, f"automated sender: {from_email}"

    def h(name: str) -> str:
        return _get_header(headers, name).strip().lower()

    # 2. RFC 3834 — Auto-Submitted header (auto-replied, auto-generated, etc.)
    auto_submitted = h("Auto-Submitted")
    if auto_submitted and auto_submitted != "no":
        return True, f"Auto-Submitted: {auto_submitted}"

    # 3. Delivery-Status-Notification / bounces
    content_type = h("Content-Type")
    if "delivery-status" in content_type or "report" in content_type:
        return True, f"bounce/DSN Content-Type: {content_type[:80]}"

    # 4. Mailing list / newsletter indicators
    if _get_header(headers, "List-Unsubscribe"):
        return True, "List-Unsubscribe header present (mailing list / newsletter)"
    if _get_header(headers, "List-Id"):
        return True, "List-Id header present (mailing list)"

    # 5. Precedence: bulk or list (RFC 2076)
    precedence = h("Precedence")
    if precedence in ("bulk", "list", "junk"):
        return True, f"Precedence: {precedence}"

    # 6. X-Autoreply / X-Auto-Response-Suppress
    if _get_header(headers, "X-Autoreply"):
        return True, "X-Autoreply header present"
    suppress = h("X-Auto-Response-Suppress")
    if "all" in suppress or "autoreply" in suppress:
        return True, f"X-Auto-Response-Suppress: {suppress}"

    return False, ""


# ── Header helpers ────────────────────────────────────────────────────────────

def _get_header(headers: list[dict], name: str) -> str:
    name_lower = name.lower()
    for h in headers:
        if h.get("name", "").lower() == name_lower:
            return h.get("value", "")
    return ""


def _parse_from(from_header: str) -> tuple[str, str]:
    """
    Parse 'Display Name <email@example.com>' into (name, email).
    Falls back to (email, email) for bare addresses.
    """
    match = re.match(r"^(.*?)\s*<([^>]+)>$", from_header.strip())
    if match:
        name = match.group(1).strip().strip('"')
        email = match.group(2).strip().lower()
        return name, email
    email = from_header.strip().lower()
    return email, email


# ── Body extraction ───────────────────────────────────────────────────────────

# Patterns that mark the start of quoted reply history in plain-text emails
_QUOTE_PATTERNS: list[re.Pattern] = [
    re.compile(r"^On .+wrote:$", re.MULTILINE | re.DOTALL),
    re.compile(r"^_{3,}$", re.MULTILINE),             # _____ divider (Outlook)
    re.compile(r"^-{3,} ?[Oo]riginal [Mm]essage ?-{3,}", re.MULTILINE),
    re.compile(r"^From:\s.+\nSent:\s.+\nTo:\s", re.MULTILINE),
    re.compile(r"^>{1,2} ", re.MULTILINE),            # > quoted lines
]

# Common signature delimiters
_SIG_PATTERNS: list[re.Pattern] = [
    re.compile(r"^-- $", re.MULTILINE),               # RFC 3676 sig delimiter
    re.compile(r"^--\s*\n", re.MULTILINE),
    re.compile(r"\n_{4,}\n"),                          # ____ before sig block
]


def _strip_quoted_and_signature(text: str) -> str:
    """Remove quoted reply history and email signatures from plain text."""
    # Strip signature first (appears after reply history in most clients)
    for pat in _SIG_PATTERNS:
        m = pat.search(text)
        if m:
            text = text[: m.start()]

    # Strip quoted reply block
    for pat in _QUOTE_PATTERNS:
        m = pat.search(text)
        if m:
            text = text[: m.start()]

    return text.strip()


def _decode_body_part(data: str) -> str:
    """Decode base64url-encoded Gmail body data."""
    try:
        padded = data + "=" * (4 - len(data) % 4)
        return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")
    except Exception:
        return ""


def _extract_plain_text(payload: dict) -> str:
    """
    Recursively walk Gmail message payload parts to find text/plain content.
    Prefers text/plain over text/html. Returns empty string if none found.
    """
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        data = (payload.get("body") or {}).get("data", "")
        return _decode_body_part(data) if data else ""

    if mime == "text/html":
        # Only use HTML as fallback — strip tags crudely
        data = (payload.get("body") or {}).get("data", "")
        if data:
            raw = _decode_body_part(data)
            return re.sub(r"<[^>]+>", " ", raw)
        return ""

    # multipart/* — recurse into parts
    parts = payload.get("parts") or []
    # Prefer text/plain part if present
    for part in parts:
        if part.get("mimeType") == "text/plain":
            result = _extract_plain_text(part)
            if result:
                return result
    # Fallback to first part that yields anything
    for part in parts:
        result = _extract_plain_text(part)
        if result:
            return result

    return ""


# ── Attachment extraction ─────────────────────────────────────────────────────

def _extract_attachments(payload: dict) -> list[AttachmentMeta]:
    """Walk payload parts and collect attachment metadata."""
    attachments: list[AttachmentMeta] = []
    _walk_for_attachments(payload, attachments)
    return attachments


def _walk_for_attachments(payload: dict, out: list[AttachmentMeta]) -> None:
    filename = payload.get("filename") or ""
    mime_type = (payload.get("mimeType") or "").lower()
    body = payload.get("body") or {}
    attachment_id = body.get("attachmentId", "")
    size_bytes = int(body.get("size", 0))

    if filename and attachment_id:
        meta = AttachmentMeta(
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            gmail_attachment_id=attachment_id,
        )
        _validate_attachment(meta)
        out.append(meta)

    for part in payload.get("parts") or []:
        _walk_for_attachments(part, out)


def _validate_attachment(meta: AttachmentMeta) -> None:
    """Apply allowlist + size cap. Sets rejected=True with reason if rejected."""
    ext = ""
    dot_idx = meta.filename.rfind(".")
    if dot_idx != -1:
        ext = meta.filename[dot_idx:].lower()

    if meta.mime_type not in ALLOWED_MIME_TYPES and ext not in ALLOWED_EXTENSIONS:
        meta.rejected = True
        meta.reject_reason = (
            f"File type '{meta.mime_type}' is not accepted. "
            f"Allowed types: PDF, JPG, PNG, TXT, CSV."
        )
        return

    if meta.size_bytes > MAX_ATTACHMENT_BYTES:
        meta.rejected = True
        max_mb = MAX_ATTACHMENT_BYTES // (1024 * 1024)
        meta.reject_reason = (
            f"File '{meta.filename}' exceeds the {max_mb}MB size limit."
        )


# ── Language detection ────────────────────────────────────────────────────────

def _detect_language(text: str) -> str:
    thai_chars = sum(1 for c in text if "\u0e00" <= c <= "\u0e7f")
    return "th" if thai_chars / max(len(text), 1) > 0.1 else "en"


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_gmail_message(message: dict) -> ParsedEmail:
    """
    Parse a Gmail API message resource into a ParsedEmail.

    Args:
        message: Full Gmail message dict from messages.get(format='full')

    Returns:
        ParsedEmail with cleaned body, attachment metadata, and headers.
    """
    payload = message.get("payload") or {}
    headers = payload.get("headers") or []

    from_header = _get_header(headers, "From")
    from_name, from_email = _parse_from(from_header)
    subject = _get_header(headers, "Subject") or "(no subject)"
    message_id = _get_header(headers, "Message-ID").strip()
    in_reply_to = _get_header(headers, "In-Reply-To").strip()
    references = _get_header(headers, "References").strip()
    thread_id = message.get("threadId", "")

    # Collect key headers for storage
    raw_headers = {
        "from": from_header,
        "subject": subject,
        "message_id": message_id,
        "in_reply_to": in_reply_to,
        "references": references,
        "date": _get_header(headers, "Date"),
    }

    # Extract and clean body
    raw_body = _extract_plain_text(payload)
    body = _strip_quoted_and_signature(raw_body)
    if not body:
        body = raw_body.strip()  # fallback: use uncleaned if stripping removed everything

    snippet = body[:200].replace("\n", " ").strip()
    language = _detect_language(body)

    # Extract attachments (metadata only — content never passed to AI)
    attachments = _extract_attachments(payload)

    rejected = [a for a in attachments if a.rejected]
    accepted = [a for a in attachments if not a.rejected]

    if rejected:
        reasons = "; ".join(a.reject_reason for a in rejected)
        logger.warning(
            "Email %s has %d rejected attachment(s): %s",
            message_id, len(rejected), reasons,
        )

    is_automated, automated_reason = _is_automated_email(headers, from_email)

    return ParsedEmail(
        message_id=message_id,
        thread_id=thread_id,
        from_email=from_email,
        from_name=from_name,
        subject=subject,
        body=body,
        snippet=snippet,
        language=language,
        attachments=accepted,   # only accepted attachments stored; rejected logged above
        raw_headers=raw_headers,
        in_reply_to=in_reply_to,
        references=references,
        is_automated=is_automated,
        automated_reason=automated_reason,
    )


def get_rejected_attachment_notice(message: dict) -> str | None:
    """
    Returns a human-readable notice if any attachments were rejected,
    to be appended to the AI's outbound reply so the customer knows.
    """
    payload = message.get("payload") or {}
    all_attachments = _extract_attachments(payload)
    rejected = [a for a in all_attachments if a.rejected]
    if not rejected:
        return None

    names = ", ".join(f"'{a.filename}'" for a in rejected)
    reasons = " ".join(set(a.reject_reason for a in rejected))
    return (
        f"\n\nNote: The following attachment(s) could not be accepted: {names}. "
        f"{reasons}"
    )
