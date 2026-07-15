import os

# Set dummy env vars before any app imports so Settings() doesn't fail in tests.
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("OPEN_MODEL_API_KEY", "")
os.environ.setdefault("HF_TOKEN", "")
os.environ.setdefault("HUGGINGFACE_API_KEY", "")
os.environ.setdefault("OPEN_MODEL_ALLOW_ANONYMOUS", "false")
os.environ.setdefault("OPEN_MODEL_INCLUDE_TRANSCRIPT", "false")
