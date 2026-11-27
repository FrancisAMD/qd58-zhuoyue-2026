from pathlib import Path
from tempfile import gettempdir
from zipfile import ZipFile
from xml.etree import ElementTree as ET

path = Path(gettempdir()) / "qd58-admin-xlsx-export-smoke.xlsx"
assert path.exists(), f"XLSX fixture not found: {path}"
try:
    with ZipFile(path) as archive:
        assert archive.testzip() is None, "ZIP CRC validation failed"
        names = set(archive.namelist())
        assert {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"}.issubset(names)
        for name in names:
            if name.endswith(".xml") or name.endswith(".rels"):
                ET.fromstring(archive.read(name))
        ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        cells = {cell.attrib["r"]: "".join(node.text or "" for node in cell.findall(".//x:t", ns)) for cell in sheet.findall(".//x:c", ns)}
        assert cells["A1"] == "用户编号"
        assert cells["B1"] == "姓名"
        assert cells["B2"] == '=HYPERLINK("https://evil.example")'
        assert cells["C2"] == "青岛五十八中 🚀"
        assert cells["D2"] == "测试大学"
        assert cells["I1"] == "群聊归属地区"
        assert cells["I2"] == "山东省"
        assert cells["J1"] == "入群确认状态"
        assert cells["J2"] == "二维码服务暂不可用"
        assert cells["K1"] == "入群确认时间"
        assert cells["L1"] == "资料同意状态"
        assert cells["L2"] == "已同意"
        assert not sheet.findall(".//x:f", ns), "all cells must be strings, never formulas"
        pane = sheet.find(".//x:pane", ns)
        assert pane is not None and pane.attrib.get("state") == "frozen"
        auto_filter = sheet.find(".//x:autoFilter", ns)
        assert auto_filter is not None and auto_filter.attrib.get("ref") == "A1:N2"
        raw = b"".join(archive.read(name) for name in names)
        assert b"13800000000" not in raw, "phone number leaked into workbook"
        assert b"private bio" not in raw, "private note leaked into workbook"
    print("XLSX ZIP/XML validation passed")
finally:
    path.unlink(missing_ok=True)
