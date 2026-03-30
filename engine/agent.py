"""
Main AI Support Engine.
Orchestrates: language detection → security filter → RAG retrieval →
account tools → Gemini Flash (JSON response with confidence) → compliance filter → escalation.

Gemini is instructed to return structured JSON: {response, confidence, needs_human}.
This means escalation is driven by Gemini's own assessment, not post-hoc heuristics.
"""
import json, re
from google import genai
from google.genai import types as genai_types
from google.genai import errors as genai_errors
from config.settings import GEMINI_API_KEY, MODEL, MAX_TOKENS
from engine.retriever import retrieve_with_fallback
from engine.account_tools import TOOLS, TOOL_DEFINITIONS
from engine.security_filter import pre_filter, post_filter, contains_financial_advice_request
from engine.escalation import should_escalate
from engine.prompt_templates import (
    get_system_prompt, build_user_message,
    build_handoff_message, ESCALATION_MESSAGES, UNABLE_TO_HELP_MESSAGES,
)
from engine.mock_agents import pick_agent, detect_category_from_message, get_intro_message
from db.conversation_store import (
    get_history, add_message, create_ticket,
    get_ai_persona, update_ticket_status,
    get_ticket_id_by_conversation,
)
from db.vector_store import collection_count

client = genai.Client(api_key=GEMINI_API_KEY)

_LANG_KEYWORDS_TH = ["ขอ", "คุณ", "ไม่", "ได้", "ว่า", "ใน", "และ", "มี", "การ", "ที่"]


def detect_language(text: str) -> str:
    """Simple Thai detection by Unicode range. Defaults to English."""
    thai_chars = sum(1 for c in text if "\u0e00" <= c <= "\u0e7f")
    return "th" if thai_chars / max(len(text), 1) > 0.1 else "en"


class AgentResponse:
    def __init__(self, text: str, language: str, escalated: bool = False,
                 escalation_reason: str = "", ticket_id: str | None = None,
                 agent_name: str | None = None, agent_avatar: str | None = None,
                 agent_avatar_url: str | None = None, resolved: bool = False,
                 specialist_intro: str | None = None):
        self.text = text
        self.language = language
        self.escalated = escalated
        self.escalation_reason = escalation_reason
        self.ticket_id = ticket_id
        self.agent_name = agent_name
        self.agent_avatar = agent_avatar
        self.agent_avatar_url = agent_avatar_url
        self.resolved = resolved
        self.specialist_intro = specialist_intro


def chat(
    conversation_id: str,
    user_id: str,
    user_message: str,
    platform: str = "web",
    consecutive_low_confidence: int = 0,
    category: str | None = None,
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
        ticket_id = get_ticket_id_by_conversation(conversation_id)
        if ticket_id:
            update_ticket_status(ticket_id, "pending_human")
        effective_category = detect_category_from_message(user_message) or category
        return AgentResponse(
            text=build_handoff_message(effective_category, language),
            language=language, escalated=True,
            escalation_reason=reason, ticket_id=ticket_id,
        )

    # 4. RAG retrieval
    rag_chunks = retrieve_with_fallback(user_message) if collection_count() > 0 else []

    # 5. Conversation history
    history = get_history(conversation_id, limit=10)

    # 6. Build messages for Gemini
    system_prompt = get_system_prompt(language, category)
    augmented_message = build_user_message(user_message, rag_chunks, {})

    # Convert history to Gemini format
    gemini_history = []
    for msg in history:
        role = "model" if msg["role"] == "assistant" else "user"
        gemini_history.append(
            genai_types.Content(role=role, parts=[genai_types.Part(text=msg["content"])])
        )

    # 7. Call Gemini Flash with account tools
    tools = [genai_types.Tool(function_declarations=TOOL_DEFINITIONS)]
    config = genai_types.GenerateContentConfig(
        system_instruction=system_prompt,
        tools=tools,
        max_output_tokens=MAX_TOKENS,
    )

    gemini_messages = gemini_history + [
        genai_types.Content(role="user", parts=[genai_types.Part(text=augmented_message)])
    ]
    try:
        final_response = client.models.generate_content(
            model=MODEL, contents=gemini_messages, config=config
        )
    except genai_errors.APIError as e:
        import logging
        logging.error("Gemini API error: %s", e)
        fallback = ("I'm having trouble connecting to our AI service right now. Please try again in a moment."
                    if language == "en"
                    else "ขณะนี้ไม่สามารถเชื่อมต่อกับระบบ AI ได้ กรุณาลองใหม่อีกครั้งในอีกสักครู่")
        return AgentResponse(text=fallback, language=language)

    # 8. Handle function calls (account data lookups)
    account_data = {}

    while True:
        fn_calls = [
            part.function_call
            for part in final_response.candidates[0].content.parts
            if part.function_call
        ]
        if not fn_calls:
            break

        fn_response_parts = []
        for fn_call in fn_calls:
            tool_fn = TOOLS.get(fn_call.name)
            if tool_fn:
                kwargs = dict(fn_call.args)
                # Inject authenticated user_id — never trust tool input for this
                result = tool_fn(user_id=user_id, **kwargs)
                account_data[fn_call.name] = result
                fn_response_parts.append(
                    genai_types.Part(
                        function_response=genai_types.FunctionResponse(
                            name=fn_call.name,
                            response={"result": result},
                        )
                    )
                )

        if not fn_response_parts:
            break

        gemini_messages = gemini_messages + [
            final_response.candidates[0].content,
            genai_types.Content(role="user", parts=fn_response_parts),
        ]
        try:
            final_response = client.models.generate_content(
                model=MODEL, contents=gemini_messages, config=config
            )
        except genai_errors.APIError as e:
            import logging
            logging.error("Gemini API error (tool loop): %s", e)
            fallback = ("I'm having trouble connecting to our AI service right now. Please try again in a moment."
                        if language == "en"
                        else "ขณะนี้ไม่สามารถเชื่อมต่อกับระบบ AI ได้ กรุณาลองใหม่อีกครั้งในอีกสักครู่")
            return AgentResponse(text=fallback, language=language)

    # 9. Extract and parse Gemini's JSON response
    raw_text = ""
    for part in final_response.candidates[0].content.parts:
        if hasattr(part, "text") and part.text:
            raw_text += part.text

    response_text, confidence, needs_human, resolved = _parse_gemini_response(raw_text, language)

    # 10. Compliance post-filter
    response_text = post_filter(response_text)

    # 11. Escalation: Gemini's own needs_human flag OR keyword triggers
    keyword_escalate, reason = should_escalate(user_message, confidence, consecutive_low_confidence)
    escalate = needs_human or keyword_escalate
    if not reason:
        reason = "low_confidence" if confidence < 0.6 else "model_requested"

    if escalate:
        ticket_id = get_ticket_id_by_conversation(conversation_id)
        if ticket_id:
            update_ticket_status(ticket_id, "pending_human")
        # Prefer the category inferred from the current message over the session default
        effective_category = detect_category_from_message(user_message) or category
        return AgentResponse(
            text=build_handoff_message(effective_category, language),
            language=language, escalated=True,
            escalation_reason=reason, ticket_id=ticket_id,
        )

    return AgentResponse(text=response_text, language=language, resolved=resolved)


def _parse_gemini_response(raw: str, language: str) -> tuple[str, float, bool, bool]:
    """
    Parse Gemini's structured JSON response.
    Returns (response_text, confidence, needs_human, resolved).
    Falls back gracefully if JSON is malformed.
    """
    if not raw:
        return UNABLE_TO_HELP_MESSAGES.get(language, UNABLE_TO_HELP_MESSAGES["en"]), 0.0, True, False

    # Strip markdown code fences if present
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip(), flags=re.MULTILINE)

    try:
        data = json.loads(cleaned)
        response_text = str(data.get("response", "")).strip()
        confidence = float(data.get("confidence", 0.5))
        needs_human = bool(data.get("needs_human", False))
        resolved = bool(data.get("resolved", False))
        if not response_text:
            response_text = UNABLE_TO_HELP_MESSAGES.get(language, UNABLE_TO_HELP_MESSAGES["en"])
            needs_human = True
        return response_text, confidence, needs_human, resolved
    except (json.JSONDecodeError, ValueError, TypeError):
        # Gemini didn't return valid JSON — treat raw text as response, flag low confidence
        # Do NOT set needs_human=True here; let the confidence threshold handle escalation
        # to avoid prematurely escalating on the next user message.
        return raw.strip(), 0.4, False, False
