from gen_ai_hub.proxy.langchain.openai import ChatOpenAI
from gen_ai_hub.proxy.core.proxy_clients import get_proxy_client

_llm = None


def get_llm():
    global _llm
    if _llm is None:
        proxy_client = get_proxy_client("gen-ai-hub")
        _llm = ChatOpenAI(
            proxy_model_name="claude-sonnet-4-6",
            proxy_client=proxy_client,
        )
    return _llm
