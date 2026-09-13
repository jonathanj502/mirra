from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    supabase_url: str
    supabase_service_role_key: str
    openai_api_key: str = ""
    openai_debrief_model: str = "gpt-4.1"
    openai_reflect_model: str = "gpt-4.1-mini"
    free_tier_cap: int = 5
    cors_origins: str = "*"
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""
    stripe_trial_days: int = 14
    stripe_success_url: str = "http://127.0.0.1:8081/profile?checkout=success"
    stripe_cancel_url: str = "http://127.0.0.1:8081/profile?checkout=cancelled"
    stripe_portal_return_url: str = "http://127.0.0.1:8081/profile"

    model_config = SettingsConfigDict(env_file=".env")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
