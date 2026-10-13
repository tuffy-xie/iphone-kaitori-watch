-- 一丁目聚焦模式：daily_best 增加一丁目价格列（报告与订单判定统一以 focus 店为基准）
ALTER TABLE daily_best ADD COLUMN ichimonme_price INTEGER;
ALTER TABLE daily_best ADD COLUMN ichimonme_morning_price INTEGER;
