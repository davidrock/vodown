"""Convert bounded .NET TRX result files into CircleCI's JUnit format."""
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

source, destination = map(Path, sys.argv[1:3])
destination.mkdir(parents=True, exist_ok=True)
ns = {"t": "http://microsoft.com/schemas/VisualStudio/TeamTest/2010"}
for file in source.glob("*.trx"):
    root = ET.parse(file).getroot()
    definitions = {}
    for definition in root.findall(".//t:UnitTest", ns):
        method = definition.find("t:TestMethod", ns)
        definitions[definition.get("id")] = method.get("className", "") if method is not None else ""
    suite = ET.Element("testsuite", name=file.stem, tests="0", failures="0", skipped="0")
    failures = skipped = count = 0
    for result in root.findall(".//t:UnitTestResult", ns):
        count += 1
        case = ET.SubElement(suite, "testcase", name=result.get("testName", "unknown"), classname=definitions.get(result.get("testId"), ""))
        duration = result.get("duration", "0:0:0").split(":")
        if len(duration) == 3:
            case.set("time", str(int(duration[0]) * 3600 + int(duration[1]) * 60 + float(duration[2])))
        if result.get("outcome") == "NotExecuted":
            skipped += 1
            ET.SubElement(case, "skipped")
        elif result.get("outcome") != "Passed":
            failures += 1
            failure = ET.SubElement(case, "failure", message=result.get("outcome", "Unknown"))
            failure.text = "\n".join(result.itertext()).strip()
    suite.set("tests", str(count))
    suite.set("failures", str(failures))
    suite.set("skipped", str(skipped))
    ET.ElementTree(suite).write(destination / f"{file.stem}.xml", encoding="utf-8", xml_declaration=True)
