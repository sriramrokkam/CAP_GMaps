import time
import httpx


class ODataClient:
    def __init__(self, settings):
        self._settings = settings
        self._token: str | None = None
        self._token_expiry: float = 0

    def _get_token(self) -> str:
        if self._token and time.time() < self._token_expiry - 60:
            return self._token
        resp = httpx.post(
            f"{self._settings.xsuaa_url}/oauth/token",
            data={"grant_type": "client_credentials"},
            auth=(self._settings.xsuaa_client_id, self._settings.xsuaa_client_secret),
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expiry = time.time() + data["expires_in"]
        return self._token

    def get(self, path: str, params: dict | None = None) -> dict:
        resp = httpx.get(
            f"{self._settings.cap_base_url}{path}",
            params=params,
            headers={"Authorization": f"Bearer {self._get_token()}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()

    def post(self, path: str, body: dict) -> dict:
        resp = httpx.post(
            f"{self._settings.cap_base_url}{path}",
            json=body,
            headers={"Authorization": f"Bearer {self._get_token()}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
