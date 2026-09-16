from typing import Literal
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    environment: Literal['development', 'production'] = 'development'
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str = ""
    openai_debrief_model: str = "gpt-4.1"
    openai_reflect_model: str = "gpt-4.1-mini"
    free_tier_cap: int = 5
    recording_storage_dir: str = ".recordings"
    cors_origins: str = "*"

    model_config = SettingsConfigDict(env_file=".env")

    @model_validator(mode='after')
    def production_requirements(self):
        if self.environment == 'production':
            if not self.openai_api_key or not self.supabase_service_role_key or not self.supabase_url.startswith('https://'):
                raise ValueError('Production requires OpenAI and Supabase credentials and HTTPS Supabase.')
            if not self.cors_origins_list or any(not origin.startswith('https://') for origin in self.cors_origins_list):
                raise ValueError('Production requires explicit HTTPS CORS origins.')
        return self

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
