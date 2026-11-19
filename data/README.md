# 高校目录数据契约（v1）

本目录定义“卓越·2026”高校主数据的唯一 JSON 格式。它是**数据源**，不是运行时查询接口；正式运行时由导入器将经核验的数据写入 Cloudflare D1。当前提交只建立格式和校验规则，不导入高校名单、不改动现有 D1。

## 文件

- `university-catalog.schema.json`：JSON Schema 2020-12，约束字段形状和枚举。
- `university-catalog.template.json`：可复制的空目录模板。
- 完整数据文件建议命名为 `university-catalog.json`，不要覆盖模板。

## 三种一级分类

| category | 范围 | 地域粒度 |
| --- | --- | --- |
| `mainland` | 中国内地本科高校；普通、民办、职业本科、军事、公安、民族、艺术、体育、中外合作等均放在这里 | 省级必填，城市可选 |
| `hmt` | 香港、澳门、台湾高校 | 只记录香港/澳门/台湾 |
| `overseas` | 其他国家和地区的高校 | 只记录国家，不记录州、省、城市 |

内地“中外合作办学”不再是一级分类，使用 `school_type_tags: ["sino_foreign_cooperative"]`。内地记录必须在 `degree_levels` 中包含 `undergraduate`；专科层次但不具有本科层次的院校不纳入本目录。职业本科属于本科范围，可纳入并标记 `vocational`。

## 单条记录示意

以下仅展示字段结构，名称、代码、标签和来源均为占位说明，**不能作为真实高校数据导入**：

```json
{
  "id": "mainland:CN-00000",
  "official_school_code": null,
  "name_zh": "学校官方中文全称",
  "name_en": null,
  "aliases": ["常用简称"],
  "category": "mainland",
  "degree_levels": ["undergraduate", "postgraduate"],
  "ownership": "public",
  "school_type_tags": ["comprehensive"],
  "project_tags": ["project_985_legacy", "project_211_legacy", "double_first_class_round2"],
  "double_first_class_disciplines": [],
  "location": {
    "country_code": "CN",
    "country_name_zh": "中国",
    "country_name_en": "China",
    "province_code": "CN-37",
    "province_name_zh": "山东省",
    "city_name_zh": "青岛市"
  },
  "campus_structure": "multiple",
  "has_branch_campus": null,
  "campus_info_status": "partial",
  "campuses": [
    {
      "id": "main",
      "name_zh": "主校区名称",
      "name_en": null,
      "is_main_campus": true,
      "is_branch_campus": false,
      "location": {
        "country_code": "CN",
        "country_name_zh": "中国",
        "country_name_en": "China",
        "province_code": "CN-37",
        "province_name_zh": "山东省",
        "city_name_zh": "青岛市"
      }
    }
  ],
  "source_records": [],
  "verification": {
    "status": "needs_review",
    "verified_at": null,
    "verified_fields": [],
    "notes": "待按官方来源核验"
  },
  "status": "active",
  "merged_into": null
}
```

## 字段规则

### 身份与名称

- `id` 是稳定主键，建议格式：`mainland:<教育部学校标识码>`、`hmt:<HK|MO|TW>:<slug>`、`overseas:<ISO-3166-1 alpha-2>:<slug>`。一经进入 D1 不要因改名而改变 ID。
- `official_school_code` 只填可核验的官方学校标识码；没有可靠代码就填 `null`，不要自行编造。
- `name_zh`、`name_en` 至少填写一个；`aliases` 只放确实使用过的简称、旧称或常见译名。
- 同一所大学的不同校区放在同一条记录里。具有独立学校身份/独立招生主体的学校分别建档，不把它们当作校区。

### 标签

- `school_type_tags` 描述办学类型，可多选；`ownership` 单独描述公办/民办等属性。
- `project_tags` 只表示建设项目沿革：985、211 使用 `*_legacy`；双一流明确区分第一轮和第二轮。
- 985/211/双一流不是学校类型，不要写入 `school_type_tags`。
- 港澳台和海外高校的 `project_tags` 应为空数组。不要把其他国家的排名或认证映射成中国的 985/211/双一流。
- `double_first_class_disciplines` 只填写有可靠依据的学科名称；未核实不要推测。

### 地域

- `location` 是学校主体所在地；每个校区的 `location` 是该校区所在地。
- 内地：`country_code=CN`，必须填写省代码和省名称；城市可选。省代码建议使用 ISO 3166-2:CN 格式。
- 港澳台：`country_code` 分别使用 `HK`、`MO`、`TW`，省/市字段必须为 `null`。
- 海外：`country_code` 使用 ISO 3166-1 alpha-2；省/州和城市字段必须为 `null`，严格只到国家层级。
- 不要把“校区多”误写成“分校”。`campus_structure` 描述校区数量；独立法人或独立招生高校应另建记录。

### 校区完整度与分校

- `campus_structure` 记录单校区/多校区/未知；`has_branch_campus` 单独记录是否存在正式分校：`true`、`false` 或 `null`（未核实）。多校区不等于有分校。
- 每个校区用 `is_branch_campus` 标记；主校区不能同时标记为分校。
- 只有校区清单完整核验后，才能把 `has_branch_campus` 设为 `false`；若为 `true`，至少要有一条校区记录标记为分校。
- `complete`：已核实校区列表，至少一个校区，且恰好一个主校区。
- `partial`：只掌握部分校区；不得声称完整。
- `not_collected`：尚未采集校区，`campuses` 必须为空。
- `unknown`：无法判断。
- 不确定是否有分校/多个校区时使用 `unknown`，不要根据搜索摘要推断。

### 来源与核验

- 每个来源记录都应有发布机构、标题、URL、访问日期和支持的字段。
- 优先使用教育主管部门、高校官网和正式招生章程；百科、论坛、搜索摘要只可作为线索，不能单独支持 `verified`。
- `verification.status=verified` 只能在关键字段已由可信来源逐项核验后使用；否则使用 `draft` 或 `needs_review`。
- 不允许 AI 补造 URL、学校代码、校区名称、985/211/双一流资格或学科名单。无法确认就留空、标记待核验。
- `status=merged` 时必须填写 `merged_into`，表示合并到的记录 ID；其他状态下设为 `null`。

## 生成与校验

复制模板为 `data/university-catalog.json`，更新 `dataset_version`，再逐条填入高校记录。校验命令：

```powershell
npm run validate:universities -- data/university-catalog.json
npm run test:catalog
```

校验器检查 JSON 结构、枚举、分类与地域约束、重复 ID/学校代码/规范化名称、校区完整度和来源核验要求。校验通过只代表格式和内部规则通过，不代表官方事实已被独立审查。

## 导入原则（后续里程碑）

1. 先在本地运行校验器，失败时禁止导入。
2. 导入器使用 `id` 做 upsert，不以学校名称作为主键。
3. 标签、别名、校区和来源分别存入关联表；不要把整个 JSON 字符串塞进单一 D1 字段供查询。
4. 导入必须提供 dry-run、变更摘要和事务/批次保护；默认不得删除 JSON 中暂时缺席的学校。
5. 先导入测试 D1 并检查注册搜索、同校分组和现有用户的 `university_id` 映射，再考虑生产 D1。
6. 目录导入不应自动修改现有用户的大学归属，也不应创建或合并用户队伍。

