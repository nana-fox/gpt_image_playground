CREATE TABLE studio_inspirations (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  image_asset TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX idx_studio_inspirations_public
  ON studio_inspirations(enabled, sort_order, id);

INSERT INTO studio_inspirations
  (id, category, title, description, prompt, image_asset, enabled, featured, sort_order, version, created_at, updated_at)
VALUES
  ('product', '商业', '产品海报', '打造质感产品视觉', '为一款高端无线耳机制作电影感产品海报，黑色背景，柔和轮廓光，突出精密材质和高级质感', 'inspiration-product.png', TRUE, TRUE, 10, 1, 1787896800000, 1787896800000),
  ('portrait', '人像', '自然光人像', '捕捉光影与情绪', '自然电影感人像写真，柔和侧光，安静克制的情绪，细腻肤质，深色背景', 'inspiration-portrait.png', TRUE, TRUE, 20, 1, 1787896800000, 1787896800000),
  ('social', '社媒', '旅行封面', '吸睛封面一键生成', '旅行主题社媒封面，雪山与湖面，蓝紫暮色，具有清晰的视觉中心和留白', 'inspiration-social.png', TRUE, TRUE, 30, 1, 1787896800000, 1787896800000),
  ('illustration', '插画', '云海鲸歌', '天马行空的想象世界', '巨鲸穿行在金色云海中的幻想插画，深海蓝与暖金配色，细腻笔触，宏大而宁静', 'inspiration-illustration.png', TRUE, TRUE, 40, 1, 1787896800000, 1787896800000),
  ('interior', '空间', '温暖客厅', '焕新你的理想空间', '把客厅改造成安静温暖的现代空间，低饱和米灰色，木质和布艺材质，自然光充足', 'inspiration-interior.png', TRUE, TRUE, 50, 1, 1787896800000, 1787896800000),
  ('perfume', '商业', '静奢香氛', '克制高级的品牌视觉', '高级香氛产品摄影，深色石材台面，冷调轮廓光，微微水汽，杂志广告质感', 'recent-perfume.png', TRUE, FALSE, 60, 1, 1787896800000, 1787896800000),
  ('alley', '摄影', '雨夜街巷', '城市叙事氛围感', '雨夜里的老城街巷，霓虹灯倒影，电影宽银幕构图，安静行人，写实摄影', 'recent-alley.png', TRUE, FALSE, 70, 1, 1787896800000, 1787896800000),
  ('flowers', '摄影', '百合静物', '柔和自然的静物光线', '白色百合花静物摄影，晨光穿过薄纱，低饱和背景，细腻花瓣质感，留白构图', 'recent-flowers.png', TRUE, FALSE, 80, 1, 1787896800000, 1787896800000),
  ('cat', '萌宠', '布偶猫肖像', '把日常拍成故事', '布偶猫电影感肖像，柔和窗边光，奶油色背景，浅景深，细腻毛发', 'recent-cat.png', TRUE, FALSE, 90, 1, 1787896800000, 1787896800000);
