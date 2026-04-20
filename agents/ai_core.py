import os
import time
import json
import httpx
from dotenv import load_dotenv
from typing import Any, List, Optional, Sequence, Union
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage,
)
from langchain_core.messages.ai import UsageMetadata
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import BaseTool
from langchain_core.utils.function_calling import convert_to_openai_tool

load_dotenv()

_token: str | None = None
_token_expiry: float = 0


def _get_aicore_token() -> str:
    global _token, _token_expiry
    if _token and time.time() < _token_expiry - 60:
        return _token
    resp = httpx.post(
        os.environ["AICORE_AUTH_URL"],
        data={"grant_type": "client_credentials"},
        auth=(os.environ["AICORE_CLIENT_ID"], os.environ["AICORE_CLIENT_SECRET"]),
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    _token = data["access_token"]
    _token_expiry = time.time() + data["expires_in"]
    return _token


def _openai_tool_to_anthropic(tool: dict) -> dict:
    """Convert OpenAI-format tool definition to Anthropic format."""
    fn = tool.get("function", tool)
    return {
        "name": fn["name"],
        "description": fn.get("description", ""),
        "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
    }


def _to_anthropic_messages(messages: List[BaseMessage]) -> tuple[str | None, list]:
    system = None
    anthropic_msgs = []
    for m in messages:
        if isinstance(m, SystemMessage):
            system = str(m.content)
        elif isinstance(m, HumanMessage):
            anthropic_msgs.append({"role": "user", "content": str(m.content)})
        elif isinstance(m, AIMessage):
            if m.tool_calls:
                content = []
                if m.content:
                    content.append({"type": "text", "text": str(m.content)})
                for tc in m.tool_calls:
                    content.append({
                        "type": "tool_use",
                        "id": tc["id"],
                        "name": tc["name"],
                        "input": tc["args"],
                    })
                anthropic_msgs.append({"role": "assistant", "content": content})
            else:
                anthropic_msgs.append({"role": "assistant", "content": str(m.content)})
        elif isinstance(m, ToolMessage):
            anthropic_msgs.append({
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": m.tool_call_id, "content": str(m.content)}],
            })
        else:
            anthropic_msgs.append({"role": "user", "content": str(m.content)})
    return system, anthropic_msgs


def _parse_response(data: dict) -> AIMessage:
    """Parse Anthropic response into LangChain AIMessage with tool_calls if present."""
    tool_calls = []
    text_parts = []
    for block in data.get("content", []):
        if block["type"] == "text":
            text_parts.append(block["text"])
        elif block["type"] == "tool_use":
            tool_calls.append({
                "id": block["id"],
                "name": block["name"],
                "args": block["input"],
                "type": "tool_call",
            })
    text = "".join(text_parts)
    if tool_calls:
        return AIMessage(content=text, tool_calls=tool_calls)
    return AIMessage(content=text)


class AICoreClaudeChatModel(BaseChatModel):
    """LangChain chat model backed by SAP AI Core Bedrock-invoke endpoint for Claude."""

    invoke_url: str
    resource_group: str = "default"
    max_tokens: int = 4096
    _bound_tools: list = []

    model_config = {"arbitrary_types_allowed": True}

    @property
    def _llm_type(self) -> str:
        return "aicore-claude"

    def bind_tools(self, tools: Sequence[Union[BaseTool, dict]], **kwargs) -> "AICoreClaudeChatModel":
        converted = []
        for t in tools:
            if isinstance(t, BaseTool):
                oai = convert_to_openai_tool(t)
                converted.append(_openai_tool_to_anthropic(oai))
            elif isinstance(t, dict):
                converted.append(_openai_tool_to_anthropic(t))
        clone = self.model_copy()
        clone._bound_tools = converted
        return clone

    def _generate(self, messages: List[BaseMessage], stop=None, run_manager=None, **kwargs) -> ChatResult:
        system, anthropic_msgs = _to_anthropic_messages(messages)
        body: dict[str, Any] = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": self.max_tokens,
            "messages": anthropic_msgs,
        }
        if system:
            body["system"] = system
        if stop:
            body["stop_sequences"] = stop
        if self._bound_tools:
            body["tools"] = self._bound_tools

        token = _get_aicore_token()
        resp = httpx.post(
            self.invoke_url,
            json=body,
            headers={
                "Authorization": f"Bearer {token}",
                "AI-Resource-Group": self.resource_group,
            },
            timeout=60,
        )
        resp.raise_for_status()
        msg = _parse_response(resp.json())
        return ChatResult(generations=[ChatGeneration(message=msg)])


_llm: Optional[AICoreClaudeChatModel] = None


def get_llm() -> AICoreClaudeChatModel:
    global _llm
    if _llm is None:
        deployment_id = os.environ["AICORE_DEPLOYMENT_ID"]
        base_url = os.environ["AICORE_BASE_URL"]
        _llm = AICoreClaudeChatModel(
            invoke_url=f"{base_url}/v2/inference/deployments/{deployment_id}/invoke",
            resource_group=os.environ.get("AICORE_RESOURCE_GROUP", "default"),
        )
    return _llm
