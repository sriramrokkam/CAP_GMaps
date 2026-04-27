import pytest
from unittest.mock import patch, AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_load_mcp_tools_returns_list_on_success():
    """load_mcp_tools() should return a non-empty list of LangChain tools."""
    mock_tool = MagicMock()
    mock_tool.name = "maps_get_directions"

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get_tools = AsyncMock(return_value=[mock_tool])

    with patch.dict("os.environ", {"GOOGLE_MAPS_API_KEY": "fake-key"}):
        with patch("mcp_client.MultiServerMCPClient", return_value=mock_client):
            import importlib
            import mcp_client as mod
            importlib.reload(mod)
            result = await mod.load_mcp_tools()

    assert isinstance(result, list)
    assert len(result) >= 1


@pytest.mark.asyncio
async def test_load_mcp_tools_returns_empty_list_on_failure():
    """load_mcp_tools() must not raise — returns [] on any error."""
    with patch("mcp_client.MultiServerMCPClient", side_effect=Exception("Node not found")):
        import importlib
        import mcp_client as mod
        importlib.reload(mod)
        result = await mod.load_mcp_tools()

    assert result == []


@pytest.mark.asyncio
async def test_load_mcp_tools_returns_empty_when_no_api_key():
    """load_mcp_tools() returns [] without calling MCP server if API key is missing."""
    import importlib
    import mcp_client as mod
    importlib.reload(mod)

    with patch.dict("os.environ", {"GOOGLE_MAPS_API_KEY": ""}):
        with patch("mcp_client.MultiServerMCPClient") as mock_cls:
            result = await mod.load_mcp_tools()

    assert result == []
    mock_cls.assert_not_called()


def test_get_mcp_tools_returns_cached_list():
    """get_mcp_tools() returns whatever was stored by load_mcp_tools."""
    import importlib
    import mcp_client as mod
    importlib.reload(mod)

    mod._mcp_tools = ["tool_a", "tool_b"]
    assert mod.get_mcp_tools() == ["tool_a", "tool_b"]


def test_get_mcp_tools_returns_empty_before_load():
    """get_mcp_tools() returns [] if load_mcp_tools has not been called."""
    import importlib
    import mcp_client as mod
    importlib.reload(mod)
    assert mod.get_mcp_tools() == []