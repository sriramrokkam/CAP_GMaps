import os
from dotenv import load_dotenv

load_dotenv()

MICROSOFT_APP_ID = os.environ["MICROSOFT_APP_ID"]
MICROSOFT_APP_PASSWORD = os.environ["MICROSOFT_APP_PASSWORD"]
AGENTS_API_URL = os.environ.get("AGENTS_API_URL", "http://localhost:8000")
BOT_PORT = int(os.environ.get("BOT_PORT", "3978"))
