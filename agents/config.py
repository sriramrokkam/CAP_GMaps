from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    aicore_auth_url: str
    aicore_client_id: str
    aicore_client_secret: str
    aicore_base_url: str
    aicore_deployment_id: str

    cap_base_url: str

    xsuaa_url: str
    xsuaa_client_id: str
    xsuaa_client_secret: str

    teams_webhook_url: str

    langchain_tracing_v2: str = "false"
    langchain_api_key: str = ""
    langchain_project: str = "gmaps-dispatch-agents"

    monitor_poll_interval_sec: int = 300
    unassigned_threshold_min: int = 30
    idle_threshold_min: int = 20

settings = Settings()
