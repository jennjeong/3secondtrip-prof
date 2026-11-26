"""운영 서버는 기본·짧은 JWT_SECRET 으로 켜지지 않는다."""
import pytest

from app.core.config import DEFAULT_JWT_SECRET, Settings, check_production_secrets


def _s(env, secret):
    return Settings(app_env=env, jwt_secret=secret, _env_file=None)


@pytest.mark.parametrize("secret", ["", DEFAULT_JWT_SECRET, "short-secret"])
def test_production_refuses_weak_secret(secret):
    with pytest.raises(RuntimeError):
        check_production_secrets(_s("production", secret))


def test_production_accepts_long_random_secret():
    check_production_secrets(_s("production", "x" * 16 + "Q9" * 16))


def test_local_and_test_are_not_checked():
    check_production_secrets(_s("local", DEFAULT_JWT_SECRET))
    check_production_secrets(_s("test", ""))
