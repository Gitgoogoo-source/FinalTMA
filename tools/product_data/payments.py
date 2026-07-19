"""Render frozen Telegram Stars top-up products."""


def render() -> str:
    return """insert into payments.topup_products (amount, sort_order) values (50, 1), (500, 2), (1000, 3), (5000, 4), (10000, 5);
"""
