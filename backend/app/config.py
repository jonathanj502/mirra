from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str = ""
    openai_debrief_model: str = "gpt-4.1"
    openai_reflect_model: str = "gpt-4.1-mini"
    free_tier_cap: int = 5
    cors_origins: str = "*"

    model_config = SettingsConfigDict(env_file=".env")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
