import os
from unittest.mock import patch


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
    # patch.dict with clear=True only affects os.environ; pydantic-settings also reads
    # the .env file directly. Override model_config so Settings ignores the .env file
    # during this test, ensuring only the patched env vars are used.
    with patch.dict(os.environ, env, clear=True):
        from config import get_settings, Settings
        from pydantic_settings import SettingsConfigDict
        original_config = Settings.model_config
        Settings.model_config = SettingsConfigDict(
            env_file=None, env_file_encoding="utf-8", extra="ignore"
        )
        try:
            get_settings.cache_clear()
            s = get_settings()
            assert s.cap_base_url == "https://srv.cfapps.us10.hana.ondemand.com"
            assert s.monitor_poll_interval_sec == 300
            assert s.unassigned_threshold_min == 30
            assert s.idle_threshold_min == 20
            assert s.langchain_tracing_v2 is False
        finally:
            Settings.model_config = original_config
            get_settings.cache_clear()
