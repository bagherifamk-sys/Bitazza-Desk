"""
Main AI Support Engine.
Orchestrates: language detection → security filter → RAG retrieval →
account tools → Claude Haiku → compliance filter → escalation decision.
"""
import json
import anthropic
from config.settings import ANTHROPIC_API_KEY, MODEL, MAX_TOKENS
from engine.retriever import retrieve_with_fallback
from engine.account_tools import TOOLS, TOOL_DEFINITIONS
from engine.security_filter import pre_filter, post_filter, contains_financial_advice_request
from engine.escalation import should_escalate, estimate_confidence
from engine.prompt_templates import (
    get_system_prompt, build_user_message,
    ESCALATION_MESSAGES, UNABLE_TO_HELP_MESSAGES,
)
from db.conversation_store import get_history, add_message, create_ticket
from db.vector_store import collection_count

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

_LANG_KEYWORDS_TH = ["ขอ", "คุณ", "ไม่", "ได้", "ว่า", "ใน", "และ", "มี", "การ", "ที่"]


def detect_language(text: str) -> str:
    """Simple Thai detection by Unicode range. Defaults to English."""
    thai_chars = sum(1 for c in text if "\u0e00" <= c <= "\u0e7f")
    return "th" if thai_chars / max(len(text), 1) > 0.1 else "en"


class AgentResponse:
    def __init__(self, text: str, language: str, escalated: bool = False,
                 escalation_reason: str = "", ticket_id: str | None = None):
        self.text = text
        self.language = language
        self.escalated = escalated
        self.escalation_reason = escalation_reason
        self.ticket_id = ticket_id


def chat(
    conversation_id: str,
    user_id: str,
    user_message: str,
    platform: str = "web",
    consecutive_low_confidence: int = 0,
) -> AgentResponse:
    """
    Process a user message and return an AgentResponse.
    Caller is responsible for persisting messages via conversation_store.
    """
    language = detect_language(user_message)

    # 1. Security pre-filter
    check = pre_filter(user_message)
    if not check.allowed:
        return AgentResponse(
            text=("I'm unable to process that request. If you need help, please describe your issue normally."
                  if language == "en"
                  else "ไม่สามารถประมวลผลคำขอนั้นได้ หากคุณต้องการความช่วยเหลือ กรุณาอธิบายปัญหาของคุณตามปกติ"),
            language=language,
        )

    # 2. Financial advice guard
    if contains_financial_advice_request(user_message):
        msg = ("I'm not able to provide investment or financial advice. For trading decisions, please consult a qualified financial advisor."
               if language == "en"
               else "ไม่สามารถให้คำแนะนำการลงทุนหรือทางการเงินได้ สำหรับการตัดสินใจซื้อขาย กรุณาปรึกษาที่ปรึกษาทางการเงินที่มีคุณสมบัติ")
        return AgentResponse(text=msg, language=language)

    # 3. Check explicit escalation request before calling API
    escalate, reason = should_escalate(user_message, 1.0, consecutive_low_confidence)
    if escalate and reason == "user_requested_human":
        ticket_id = create_ticket(conversation_id, reason)
        return AgentResponse(
            text=ESCALATION_MESSAGES.get(language, ESCALATION_MESSAGES["en"]),
            language=language, escalated=True,
            escalation_reason=reason, ticket_id=ticket_id,
        )

    # 4. RAG retrieval
    rag_chunks = retrieve_with_fallback(user_message) if collection_count() > 0 else []

    # 5. Conversation history
    history = get_history(conversation_id, limit=10)

    # 6. Build messages for Claude
    system_prompt = get_system_prompt(language)
    augmented_message = build_user_message(user_message, rag_chunks, {})

    messages = history + [{"role": "user", "content": augmented_message}]

    # 7. Call Claude Haiku with account tools
    response = client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system_prompt,
        tools=TOOL_DEFINITIONS,
        messages=messages,
    )

    # 8. Handle tool use (account data lookups)
    account_data = {}
    final_response = response

    while final_response.stop_reason == "tool_use":
        tool_results = []
        for block in final_response.content:
            if block.type == "tool_use":
                tool_fn = TOOLS.get(block.name)
                if tool_fn:
                    kwargs = {k: v for k, v in block.input.items()}
                    # Inject authenticated user_id — never trust tool input for this
                    result = tool_fn(user_id=user_id, **kwargs)
                    account_data[block.name] = result
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })

        if not tool_results:
            break

        # Continue conversation with tool results
        messages = messages + [
            {"role": "assistant", "content": final_response.content},
            {"role": "user", "content": tool_results},
        ]
        final_response = client.messages.create(
            model=MODEL, max_tokens=MAX_TOKENS,
            system=system_prompt, tools=TOOL_DEFINITIONS, messages=messages,
        )

    # 9. Extract text response
    response_text = ""
    for block in final_response.content:
        if hasattr(block, "text"):
            response_text += block.text

    if not response_text:
        response_text = UNABLE_TO_HELP_MESSAGES.get(language, UNABLE_TO_HELP_MESSAGES["en"])

    # 10. Compliance post-filter
    response_text = post_filter(response_text)

    # 11. Confidence + escalation check
    confidence = estimate_confidence(response_text, rag_chunks)
    escalate, reason = should_escalate(user_message, confidence, consecutive_low_confidence)

    if escalate:
        ticket_id = create_ticket(conversation_id, reason)
        escalation_msg = ESCALATION_MESSAGES.get(language, ESCALATION_MESSAGES["en"])
        return AgentResponse(
            text=response_text + "\n\n" + escalation_msg,
            language=language, escalated=True,
            escalation_reason=reason, ticket_id=ticket_id,
        )

    return AgentResponse(text=response_text, language=language)
