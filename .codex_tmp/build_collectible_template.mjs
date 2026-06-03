import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("../outputs/catalog-template");
const outputPath = path.join(outputDir, "collectible_batch_template.xlsx");
const rowCount = 101;

const lists = {
  rarities: ["COMMON", "RARE", "EPIC", "LEGENDARY"],
  itemTypes: ["CHARACTER", "PET", "EGG", "DECORATION", "MATERIAL"],
  series: ["forest_guardians", "moon_crown", "crystal_cove", "dragon_fire"],
  factions: ["forest", "lunar", "crystal", "flame"],
  releaseStatuses: ["draft", "active", "hidden", "retired"],
  booleans: ["TRUE", "FALSE"],
  boxes: ["starter_egg", "premium_egg", "legendary_egg"],
  assetStatuses: ["uploaded", "pending_upload", "external_url"],
  chainStatuses: ["draft", "active", "paused", "retired"],
};

function colLetter(index) {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - m) / 26);
  }
  return s;
}

function rangeFor(headers, startRow = 1, endRow = rowCount) {
  return `A${startRow}:${colLetter(headers.length - 1)}${endRow}`;
}

function headerRange(headers) {
  return `A1:${colLetter(headers.length - 1)}1`;
}

function styleSheet(sheet, headers, requiredKeys = []) {
  const fullRange = sheet.getRange(rangeFor(headers));
  fullRange.format = {
    font: { name: "Arial", size: 10, color: "#111827" },
    verticalAlignment: "center",
    wrapText: true,
  };
  fullRange.format.borders = { preset: "outside", style: "thin", color: "#D1D5DB" };

  const header = sheet.getRange(headerRange(headers));
  header.format = {
    fill: "#111827",
    font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
  };

  for (const key of requiredKeys) {
    const idx = headers.findIndex((h) => h.key === key);
    if (idx >= 0) {
      sheet.getRange(`${colLetter(idx)}1`).format = {
        fill: "#B91C1C",
        font: { name: "Arial", size: 10, color: "#FFFFFF", bold: true },
        horizontalAlignment: "center",
        verticalAlignment: "center",
        wrapText: true,
      };
    }
  }

  sheet.freezePanes.freezeRows(1);
  for (let i = 0; i < headers.length; i += 1) {
    const width = headers[i].width ?? 130;
    sheet.getRange(`${colLetter(i)}:${colLetter(i)}`).format.columnWidthPx = width;
  }
  sheet.getRange("1:1").format.rowHeightPx = 44;
  sheet.getRange(`A2:${colLetter(headers.length - 1)}${rowCount}`).format.rowHeightPx = 34;
}

function addTable(sheet, headers, name) {
  const table = sheet.tables.add(rangeFor(headers), true);
  table.name = name;
}

function writeBlankSheet(workbook, name, headers, requiredKeys = []) {
  const sheet = workbook.worksheets.add(name);
  const values = Array.from({ length: rowCount }, (_, row) =>
    headers.map((h) => (row === 0 ? `${h.label}${requiredKeys.includes(h.key) ? " *" : ""}` : "")),
  );
  sheet.getRange(rangeFor(headers)).values = values;
  styleSheet(sheet, headers, requiredKeys);
  addTable(sheet, headers, `tbl_${name.replace(/[^A-Za-z0-9_]/g, "_")}`);
  return sheet;
}

function applyList(sheet, headers, key, options) {
  const idx = headers.findIndex((h) => h.key === key);
  if (idx < 0) return;
  const col = colLetter(idx);
  sheet.getRange(`${col}2:${col}${rowCount}`).dataValidation = {
    allowBlank: true,
    list: { inCellDropDown: true, source: options },
  };
}

function writeInstructionSheet(workbook) {
  const sheet = workbook.worksheets.add("填写说明");
  const rows = [
    ["100 个新藏品批量导入模板", ""],
    ["使用方式", "先填 01_藏品主表；每个 slug 是一件藏品的唯一编号。再按需要填写图片、抽卡池、图鉴、交易价、进化链。"],
    ["红色表头", "必填。只要这一行要导入，就必须填。"],
    ["先用 draft", "建议 release_status 先填 draft。图片、抽卡池、图鉴、测试都通过后，再发布为 active。"],
    ["不要填玩家数据", "不要手动填写 inventory.item_instances、gacha.draw_results、album.user_discoveries、currency_ledger。玩家抽到后系统会自动写。"],
    ["图片路径", "如果图片在 Supabase Storage，建议填 /storage/v1/object/public/collectibles/xxx.png。也可以填外链，但生产更推荐自有存储。"],
    ["抽卡池", "03_抽卡池只填新增藏品要加入哪些盲盒。后续写 seed 时会创建新的池版本，不能直接改旧 active 池。"],
    ["概率", "drop_weight 是真实抽卡权重。probability_bps 主要给前端展示，10000 表示 100%。最终概率要按整个池子的权重重新算。"],
    ["进化链", "如果要做“小火龙 -> 火恐龙 -> 喷火龙”，这三个都要先在 01_藏品主表建成独立 template，再在 06_进化链写关系。"],
    ["版权提醒", "如果“小火龙”指宝可梦角色，商业项目上线前需要确认授权。没有授权时建议换原创名称和原创形象。"],
    ["我后续会做什么", "你填完发给我后，我会先读取远程 Supabase 真实表结构，再写本地 migration/seed，并先跑本地 Supabase 测试。"],
  ];
  sheet.getRange(`A1:B${rows.length}`).values = rows;
  sheet.getRange("A1:B1").format = {
    fill: "#111827",
    font: { name: "Arial", size: 14, color: "#FFFFFF", bold: true },
    verticalAlignment: "center",
  };
  sheet.getRange(`A2:A${rows.length}`).format = {
    fill: "#E5E7EB",
    font: { name: "Arial", size: 10, bold: true },
    wrapText: true,
  };
  sheet.getRange(`B2:B${rows.length}`).format = { wrapText: true };
  sheet.getRange("A:A").format.columnWidthPx = 160;
  sheet.getRange("B:B").format.columnWidthPx = 820;
  sheet.getRange(`A1:B${rows.length}`).format.rowHeightPx = 42;
  sheet.freezePanes.freezeRows(1);
}

function writeOptionsSheet(workbook) {
  const sheet = workbook.worksheets.add("下拉选项");
  const rows = [
    ["rarity_code", "type_code", "series_slug", "faction_slug", "release_status", "boolean", "box_slug", "asset_status", "chain_status"],
  ];
  const maxLen = Math.max(...Object.values(lists).map((v) => v.length));
  for (let i = 0; i < maxLen; i += 1) {
    rows.push([
      lists.rarities[i] ?? "",
      lists.itemTypes[i] ?? "",
      lists.series[i] ?? "",
      lists.factions[i] ?? "",
      lists.releaseStatuses[i] ?? "",
      lists.booleans[i] ?? "",
      lists.boxes[i] ?? "",
      lists.assetStatuses[i] ?? "",
      lists.chainStatuses[i] ?? "",
    ]);
  }
  sheet.getRange(`A1:I${rows.length}`).values = rows;
  sheet.getRange("A1:I1").format = {
    fill: "#374151",
    font: { color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
  };
  sheet.getRange("A:I").format.columnWidthPx = 150;
  sheet.freezePanes.freezeRows(1);
}

function writeExampleSheet(workbook) {
  const sheet = workbook.worksheets.add("示例_小火龙");
  const rows = [
    ["sheet", "字段", "示例值", "说明"],
    ["01_藏品主表", "slug", "xiao_huo_long", "唯一编号。建议用英文小写、数字、下划线。"],
    ["01_藏品主表", "display_name", "小火龙", "如果没有商业授权，不建议直接上线这个名称和形象。"],
    ["01_藏品主表", "rarity_code", "RARE", "只能用 COMMON/RARE/EPIC/LEGENDARY。"],
    ["01_藏品主表", "type_code", "PET", "火系幼龙可以按 PET，也可以按 CHARACTER。"],
    ["01_藏品主表", "series_slug", "dragon_fire", "现有火系系列。"],
    ["01_藏品主表", "faction_slug", "flame", "现有火系阵营。"],
    ["02_形态图片", "form_slug", "base", "默认形态。"],
    ["02_形态图片", "hero_url", "/storage/v1/object/public/collectibles/xiao_huo_long_hero.png", "大图。"],
    ["02_形态图片", "card_url", "/storage/v1/object/public/collectibles/xiao_huo_long_card.png", "卡片图。"],
    ["03_抽卡池", "box_slug", "premium_egg", "加入稀有盲盒。"],
    ["03_抽卡池", "drop_weight", "500", "真实抽卡权重，必须由你决定。"],
    ["05_交易价格", "suggested_price_kcoin", "1200", "市场建议价。"],
    ["06_进化链", "from_template_slug", "xiao_huo_long", "如果有火恐龙、喷火龙，再填进化链。"],
  ];
  sheet.getRange(`A1:D${rows.length}`).values = rows;
  sheet.getRange("A1:D1").format = {
    fill: "#111827",
    font: { color: "#FFFFFF", bold: true },
    horizontalAlignment: "center",
  };
  sheet.getRange("A:D").format.wrapText = true;
  sheet.getRange("A:A").format.columnWidthPx = 150;
  sheet.getRange("B:B").format.columnWidthPx = 210;
  sheet.getRange("C:C").format.columnWidthPx = 420;
  sheet.getRange("D:D").format.columnWidthPx = 520;
  sheet.freezePanes.freezeRows(1);
}

const mainHeaders = [
  { key: "item_no", label: "序号", width: 70 },
  { key: "slug", label: "slug", width: 180 },
  { key: "display_name", label: "英文/展示名", width: 180 },
  { key: "display_name_cn", label: "中文名", width: 150 },
  { key: "subtitle", label: "副标题", width: 180 },
  { key: "description", label: "描述", width: 360 },
  { key: "rarity_code", label: "稀有度", width: 130 },
  { key: "type_code", label: "类型", width: 130 },
  { key: "series_slug", label: "系列 slug", width: 160 },
  { key: "faction_slug", label: "阵营 slug", width: 150 },
  { key: "base_power", label: "基础战力", width: 110 },
  { key: "max_level", label: "最高等级", width: 110 },
  { key: "supply_limit", label: "发行上限", width: 110 },
  { key: "release_status", label: "发布状态", width: 130 },
  { key: "tradeable", label: "可交易", width: 100 },
  { key: "upgradeable", label: "可升级", width: 100 },
  { key: "evolvable", label: "可进化", width: 100 },
  { key: "decomposable", label: "可分解", width: 100 },
  { key: "nft_mintable", label: "可 Mint NFT", width: 120 },
  { key: "sort_order", label: "排序", width: 90 },
  { key: "nft_metadata_path", label: "NFT metadata 路径", width: 260 },
  { key: "ip_clearance_note", label: "版权/授权备注", width: 260 },
  { key: "operator_note", label: "运营备注", width: 260 },
];

const formHeaders = [
  { key: "template_slug", label: "藏品 slug", width: 180 },
  { key: "form_index", label: "形态序号", width: 100 },
  { key: "form_slug", label: "形态 slug", width: 140 },
  { key: "form_display_name", label: "形态展示名", width: 180 },
  { key: "form_description", label: "形态描述", width: 320 },
  { key: "is_default", label: "默认形态", width: 110 },
  { key: "next_form_slug", label: "下个形态 slug", width: 150 },
  { key: "base_power_bonus", label: "形态战力加成", width: 130 },
  { key: "image_url", label: "form.image_url", width: 300 },
  { key: "thumbnail_url", label: "form.thumbnail_url", width: 300 },
  { key: "avatar_url", label: "form.avatar_url", width: 300 },
  { key: "hero_url", label: "hero 图", width: 300 },
  { key: "card_url", label: "card 图", width: 300 },
  { key: "thumb_url", label: "thumb 图", width: 300 },
  { key: "avatar_media_url", label: "avatar 媒体图", width: 300 },
  { key: "nft_image_url", label: "NFT 图片", width: 300 },
  { key: "nft_metadata_url", label: "NFT metadata URL", width: 300 },
  { key: "storage_bucket", label: "storage bucket", width: 150 },
  { key: "asset_status", label: "素材状态", width: 140 },
  { key: "notes", label: "备注", width: 240 },
];

const poolHeaders = [
  { key: "box_slug", label: "盲盒 slug", width: 160 },
  { key: "template_slug", label: "藏品 slug", width: 180 },
  { key: "form_slug", label: "形态 slug", width: 140 },
  { key: "rarity_code", label: "稀有度", width: 120 },
  { key: "drop_weight", label: "抽卡权重", width: 120 },
  { key: "probability_bps", label: "展示概率 bps", width: 130 },
  { key: "stock_total", label: "池内库存上限", width: 120 },
  { key: "is_pity_eligible", label: "可进保底池", width: 120 },
  { key: "is_featured", label: "重点展示", width: 110 },
  { key: "sort_order", label: "排序", width: 90 },
  { key: "pity_rule_name", label: "保底规则名", width: 180 },
  { key: "pity_threshold", label: "保底次数", width: 110 },
  { key: "pity_target_rarity_code", label: "保底目标稀有度", width: 150 },
  { key: "guaranteed_template_slug", label: "指定保底藏品 slug", width: 200 },
  { key: "guaranteed_form_slug", label: "指定保底形态 slug", width: 170 },
  { key: "notes", label: "备注", width: 240 },
];

const albumHeaders = [
  { key: "template_slug", label: "藏品 slug", width: 180 },
  { key: "include_all_collectibles", label: "加入全图鉴", width: 130 },
  { key: "include_series_album", label: "加入系列图鉴", width: 130 },
  { key: "include_rarity_album", label: "加入稀有度图鉴", width: 150 },
  { key: "custom_album_codes", label: "额外图鉴 code", width: 260 },
  { key: "sort_order", label: "排序", width: 90 },
  { key: "notes", label: "备注", width: 260 },
];

const priceHeaders = [
  { key: "template_slug", label: "藏品 slug", width: 180 },
  { key: "form_index", label: "形态序号", width: 100 },
  { key: "min_price_kcoin", label: "最低价 KCOIN", width: 130 },
  { key: "max_price_kcoin", label: "最高价 KCOIN", width: 130 },
  { key: "suggested_price_kcoin", label: "建议价 KCOIN", width: 140 },
  { key: "active", label: "启用", width: 100 },
  { key: "notes", label: "备注", width: 260 },
];

const chainHeaders = [
  { key: "chain_code", label: "进化链 code", width: 170 },
  { key: "chain_display_name", label: "进化链名称", width: 180 },
  { key: "chain_status", label: "进化链状态", width: 130 },
  { key: "step_index", label: "步骤序号", width: 100 },
  { key: "from_template_slug", label: "来源藏品 slug", width: 180 },
  { key: "from_form_slug", label: "来源形态 slug", width: 150 },
  { key: "to_template_slug", label: "目标藏品 slug", width: 180 },
  { key: "to_form_slug", label: "目标形态 slug", width: 150 },
  { key: "required_count", label: "消耗数量", width: 100 },
  { key: "cost_kcoin", label: "消耗 KCOIN", width: 120 },
  { key: "success_rate_bps", label: "成功率 bps", width: 120 },
  { key: "active", label: "步骤启用", width: 110 },
  { key: "sort_order", label: "排序", width: 90 },
  { key: "notes", label: "备注", width: 260 },
];

const workbook = Workbook.create();
writeInstructionSheet(workbook);

const main = writeBlankSheet(workbook, "01_藏品主表", mainHeaders, [
  "slug",
  "display_name",
  "description",
  "rarity_code",
  "type_code",
  "series_slug",
  "faction_slug",
  "base_power",
  "release_status",
]);
applyList(main, mainHeaders, "rarity_code", lists.rarities);
applyList(main, mainHeaders, "type_code", lists.itemTypes);
applyList(main, mainHeaders, "series_slug", lists.series);
applyList(main, mainHeaders, "faction_slug", lists.factions);
applyList(main, mainHeaders, "release_status", lists.releaseStatuses);
for (const key of ["tradeable", "upgradeable", "evolvable", "decomposable", "nft_mintable"]) {
  applyList(main, mainHeaders, key, lists.booleans);
}

const forms = writeBlankSheet(workbook, "02_形态图片", formHeaders, [
  "template_slug",
  "form_index",
  "form_slug",
  "form_display_name",
  "is_default",
]);
applyList(forms, formHeaders, "is_default", lists.booleans);
applyList(forms, formHeaders, "asset_status", lists.assetStatuses);

const pools = writeBlankSheet(workbook, "03_抽卡池", poolHeaders, [
  "box_slug",
  "template_slug",
  "form_slug",
  "rarity_code",
  "drop_weight",
]);
applyList(pools, poolHeaders, "box_slug", lists.boxes);
applyList(pools, poolHeaders, "rarity_code", lists.rarities);
applyList(pools, poolHeaders, "is_pity_eligible", lists.booleans);
applyList(pools, poolHeaders, "is_featured", lists.booleans);
applyList(pools, poolHeaders, "pity_target_rarity_code", lists.rarities);

const album = writeBlankSheet(workbook, "04_图鉴", albumHeaders, ["template_slug"]);
for (const key of ["include_all_collectibles", "include_series_album", "include_rarity_album"]) {
  applyList(album, albumHeaders, key, lists.booleans);
}

const price = writeBlankSheet(workbook, "05_交易价格", priceHeaders, [
  "template_slug",
  "min_price_kcoin",
]);
applyList(price, priceHeaders, "active", lists.booleans);

const chain = writeBlankSheet(workbook, "06_进化链", chainHeaders, [
  "chain_code",
  "chain_display_name",
  "chain_status",
  "step_index",
  "from_template_slug",
  "from_form_slug",
  "to_template_slug",
  "to_form_slug",
  "required_count",
  "cost_kcoin",
  "success_rate_bps",
]);
applyList(chain, chainHeaders, "chain_status", lists.chainStatuses);
applyList(chain, chainHeaders, "active", lists.booleans);

writeExampleSheet(workbook);
writeOptionsSheet(workbook);

const checks = workbook.worksheets.add("模板检查");
checks.getRange("A1:B8").values = [
  ["检查项", "公式/结果"],
  ["01_藏品主表已填写 slug 数量", ""],
  ["02_形态图片已填写藏品数量", ""],
  ["03_抽卡池已填写藏品数量", ""],
  ["04_图鉴已填写藏品数量", ""],
  ["05_交易价格已填写藏品数量", ""],
  ["06_进化链已填写步骤数量", ""],
  ["提示", "这里的统计只是帮你自查，最终我会按表格内容再做一次校验。"],
];
checks.getRange("B2:B7").formulas = [
  ['=COUNTA(\'01_藏品主表\'!B2:B101)'],
  ['=COUNTA(\'02_形态图片\'!A2:A101)'],
  ['=COUNTA(\'03_抽卡池\'!B2:B101)'],
  ['=COUNTA(\'04_图鉴\'!A2:A101)'],
  ['=COUNTA(\'05_交易价格\'!A2:A101)'],
  ['=COUNTA(\'06_进化链\'!D2:D101)'],
];
checks.getRange("A1:B1").format = {
  fill: "#111827",
  font: { color: "#FFFFFF", bold: true },
  horizontalAlignment: "center",
};
checks.getRange("A:A").format.columnWidthPx = 280;
checks.getRange("B:B").format.columnWidthPx = 520;
checks.freezePanes.freezeRows(1);

for (const sheetName of ["01_藏品主表", "02_形态图片", "03_抽卡池", "04_图鉴", "05_交易价格", "06_进化链"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  sheet.getRange("A1:Z101").format.autofitRows();
}

const inspectMain = await workbook.inspect({
  kind: "table",
  range: "01_藏品主表!A1:W8",
  include: "values,formulas",
  tableMaxRows: 8,
  tableMaxCols: 23,
});
console.log(inspectMain.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

for (const sheetName of ["填写说明", "01_藏品主表", "02_形态图片", "03_抽卡池", "04_图鉴", "05_交易价格", "06_进化链", "模板检查"]) {
  await workbook.render({ sheetName, range: "A1:H18", scale: 1 });
}

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
