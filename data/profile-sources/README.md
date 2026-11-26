# 登记页数据源

前端通过 `fetch()` 从本目录读取四份结构化 JSON。页面只在运行时加载，不把高校清单硬编码进 `app.js`。

| 文件 | 用途 |
|---|---|
| `mainland-universities.json` | 1,455 所内地本科高校及其在用校区 |
| `hmt-universities.json` | 港澳台学校名称目录 |
| `major-disciplines.json` | 本科专业学科门类及传统大类映射 |
| `admission-types.json` | 招生大类和具体招生类型 |

内地高校选学校后再选校区；校区只是个人资料，不会拆分团队。港澳台只选学校名称。海外高校不从目录中选取，用户自行填写并进入审核流程。

招生途径和专业门类是两个独立字段。招生选项展示结构以招生类型 JSON 的 category/type 层级为准，保存代码使用文件内的 ID。
