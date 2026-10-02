"""Runs the ORIGINAL reference calculation (docs/spec/reference_calc.py) on JSON cases from stdin.

Used by tests/domain/calc-reference.test.ts to prove the TypeScript port matches the reference.
The calculate() function is executed verbatim from the spec file, so this harness never drifts from it.
"""
import hashlib
import json
import pathlib
import sys

SPEC = pathlib.Path(__file__).resolve().parent.parent / "docs" / "spec" / "reference_calc.py"
source = SPEC.read_text(encoding="utf-8")
start = source.index("def calculate(")
end = source.index('if __name__ == "__main__":')
namespace = {"json": json, "hashlib": hashlib}
exec(source[start:end], namespace)  # noqa: S102 - trusted file from this repository
calculate = namespace["calculate"]

data = json.load(sys.stdin)
params = data["params"]
results = []
for case in data["cases"]:
    out, *_ = calculate(case["tasks"], case["comms"], case["members"], case["finance"], params,
                        case["planned_total"], case["originated_by"])
    results.append({m: {"points": v["points"], "share": v["share"], "payout": v["payout"]} for m, v in out.items()})
json.dump(results, sys.stdout)
