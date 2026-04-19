import pytest
import respx
import httpx
from unittest.mock import MagicMock
import time


def make_settings():
    s = MagicMock()
    s.xsuaa_url = "https://xsuaa.example.com"
    s.xsuaa_client_id = "cid"
    s.xsuaa_client_secret = "sec"
    s.cap_base_url = "https://srv.example.com"
    return s


@respx.mock
def test_get_token_fetches_and_caches():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    client = ODataClient(make_settings())
    token = client._get_token()
    assert token == "tok123"
    token2 = client._get_token()
    assert token2 == "tok123"
    assert respx.calls.call_count == 1


@respx.mock
def test_get_fetches_odata_with_auth():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    respx.get("https://srv.example.com/odata/v4/ewm/OutboundDeliveries").mock(
        return_value=httpx.Response(200, json={"value": [{"DeliveryDocument": "80000001"}]})
    )
    client = ODataClient(make_settings())
    result = client.get("/odata/v4/ewm/OutboundDeliveries")
    assert result["value"][0]["DeliveryDocument"] == "80000001"


@respx.mock
def test_post_sends_json_body():
    from tools.odata_client import ODataClient
    respx.post("https://xsuaa.example.com/oauth/token").mock(
        return_value=httpx.Response(200, json={"access_token": "tok123", "expires_in": 3600})
    )
    respx.post("https://srv.example.com/odata/v4/tracking/assignDriver").mock(
        return_value=httpx.Response(200, json={"ID": "abc"})
    )
    client = ODataClient(make_settings())
    result = client.post("/odata/v4/tracking/assignDriver", {"deliveryDoc": "80000001"})
    assert result["ID"] == "abc"
