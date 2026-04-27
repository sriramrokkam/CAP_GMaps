import os
import logging
from langchain_mcp_adapters.client import MultiServerMCPClient

logger = logging.getLogger(__name__)

_mcp_tools: list = []


async def load_mcp_tools() -> list:
    """Spawn Google Maps MCP server subprocess and load its tools.
    Returns empty list on any failure — RouteAgent degrades gracefully."""
    global _mcp_tools
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if not api_key:
        logger.warning("GOOGLE_MAPS_API_KEY not set — Google Maps MCP tools will not be available")
        return []
    try:
        client = MultiServerMCPClient(
            {
                "google_maps": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-google-maps"],
                    "env": {"GOOGLE_MAPS_API_KEY": api_key},
                    "transport": "stdio",
                }
            }
        )
        tools = await client.get_tools()
        _mcp_tools = tools
        logger.info(f"Loaded {len(tools)} Google Maps MCP tools: {[t.name for t in tools]}")
        return tools
    except Exception as e:
        logger.warning(f"Google Maps MCP server failed to load (non-fatal): {e}")
        _mcp_tools = []
        return []


def get_mcp_tools() -> list:
    """Return MCP tools loaded at startup. Empty list if load_mcp_tools() was not called or failed."""
    return _mcp_tools