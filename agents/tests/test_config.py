import pytest
from unittest.mock import patch
import os

def test_settings_loads_required_vars():
    env = {
        "AICORE_AUTH_URL": "https://auth.example.com",
        "AICORE_CLIENT_ID": "client-id",
        "AICORE_CLIENT_SECRET": "secret",
        "AICORE_BASE_URL": "https://aicore.example.com",
        "AICORE_DEPLOYMENT_ID": "deploy-123",
        "CAP_BASE_URL": "https://srv.cfapps.us10.hana.ondemand.com",
        "XSUAA_URL": "https://xsuaa.example.com",
        "XSUAA_CLIENT_ID": "xsuaa-client",
        "XSUAA_CLIENT_SECRET": "xsuaa-secret",
        "TEAMS_WEBHOOK_URL": "https://outlook.office.com/webhook/xxx",
    }
    with patch.dict(os.environ, env, clear=True):
        from config import Settings
        s = Settings()
        assert s.cap_base_url == "https://srv.cfapps.us10.hana.ondemand.com"
        assert s.monitor_poll_interval_sec == 300
        assert s.unassigned_threshold_min == 30
        assert s.idle_threshold_min == 20
