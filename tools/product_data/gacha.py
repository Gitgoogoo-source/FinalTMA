"""Render frozen blind-box product rules."""


def render() -> str:
    return """insert into gacha.boxes (tier, display_name, image_path, single_price, ten_price, pity_limit, pity_rarity, rarity_weights) values
  ('normal', '普通盲盒', '/assets/boxes/normal.webp', 9, 81, 50, 'rare', '{"common":7200,"rare":2500,"epic":300,"legendary":0,"mythic":0}'),
  ('rare', '稀有盲盒', '/assets/boxes/rare.webp', 40, 360, 30, 'epic', '{"common":2000,"rare":5500,"epic":2200,"legendary":300,"mythic":0}'),
  ('legendary', '传说盲盒', '/assets/boxes/legendary.webp', 120, 1080, 15, 'legendary', '{"common":0,"rare":1800,"epic":5500,"legendary":2400,"mythic":300}');
"""
